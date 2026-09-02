# @adamancyzhang/agent-vuetools

Inspect the Vue 3 component tree (virtual DOM), props, and `<script setup>` state of a live page over CDP — **no vue-devtools extension required**. Built for AI agents: stable, machine-parseable output, plus a human-readable text format.

## How it works

The Vue 3 runtime exposes `__vue_app__` / `__vueParentComponent` markers on DOM elements. agent-vuetools connects to the browser over the Chrome DevTools Protocol (CDP), injects a probe script that walks component instances (`subTree` → `component.props` / `setupState` / `computed` / `__file`), serializes cycle-safely in-page, and returns JSON.

## Install

```bash
npm install -g @adamancyzhang/agent-vuetools
# or from source:
npm install && npm run build && npm link
```

Requires Node >= 18 and a Chrome/Edge with a debugging port:

```bash
# Launch Chrome with remote debugging (open your Vue page as usual)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

## Quick start

```bash
agent-vuetools tree                      # component tree (connects to 127.0.0.1:9222 by default)
agent-vuetools inspect Counter --json    # deep-dive Counter: prop definitions/values, setup state, computed
agent-vuetools inspect "#submit-btn"     # resolve the component owning a CSS selector match
agent-vuetools inspect '//*[text()[contains(., "Submit")]]'   # XPath targeting
agent-vuetools query '//a[contains(@class, "nav")]'           # collect matching elements + owning components
agent-vuetools style '#submit-btn'       # computed style of an element
agent-vuetools find src/components/      # locate components by __file path, with parent chains
```

## Connecting

1. **`--cdp <port|host:port|http(s)://url|ws(s)://url>`** — explicit debugging endpoint;
2. **Fallback probe of `127.0.0.1:9222`** — launch Chrome with `--remote-debugging-port=9222` and you're set.

Multiple tabs? Pick one with `--tab`: `t1`/`t2`... (1-based), exact title, or URL substring. With multiple tabs and no `--tab`, the CLI errors and lists the options.

## Commands

```
agent-vuetools tree [--depth N] [--fields ...] [--compact] [--json]
agent-vuetools inspect <query> [--fields ...] [--json]
agent-vuetools find <name|path-substring> [--json]
agent-vuetools query <xpath|css> [--limit N] [--json]
agent-vuetools style <xpath|css> [--all] [--json]

Common flags: --cdp --tab --json --help --version
--fields: props,setupState,computed,data,exposed,attrs,slots,emitted,provides,file,dom
```

- `tree` — a tree of components and elements; component nodes carry a `[DOM]` bracket, prop values, a setup-state summary, and the `__file` path. `--depth` defaults to 8 with **no upper limit** (the 5000-node cap still applies), `--compact` shows name and DOM only.
- `inspect <query>` — resolves a component by, in order: **component name** → `__file` path substring (case-insensitive) → **CSS selector** → **XPath expression** → **visible text** (implemented internally as an XPath `text()[contains()]` query). Full dump: prop definitions (type/required/default) + values, setupState, computed, data, exposed, slots, attrs, provides, declared emits, parent chain.
- `find <query>` — locate components in the tree by name or file path; prints each match's parent chain (`App → Header → NavLink`).
- `query <xpath|css>` — **collect** DOM elements (XPath or CSS selector); each match reports the element descriptor plus its owning component (name/`__file`, or null for plain DOM). Capped at 50 by default, adjust with `--limit`. Works on non-Vue pages too.
- `style <xpath|css>` — dump an element's **computed style** (a curated ~40 layout/typography/color properties by default, `--all` for everything), inline style, and explicit `tag` / `id` / **full untruncated `class`** / `text` fields for style debugging. Works on non-Vue pages too.

> XPath 1.0 note: `contains(text(), 'q')` only checks the **first** text node (elements whose text is split by template interpolation won't match). To match any direct text node, use `//*[text()[contains(., 'q')]]`.

### Text tree example

```
# 2 Vue apps found on this page
└─ App {setup: title="agent-vuetools fixture", count=3} [DIV#app-root.app-shell] (src/App.vue)
├─ h1 [H1] "agent-vuetools fixture"
├─ Counter {step: 1, count: 3, label: "Count"} {setup: props="[Props]", emit="[Emit]", doubled=6, local=7} [DIV#counter-box] (src/components/Counter.vue)
├─ TeleportBox (src/components/TeleportBox.vue)
│  └─ Teleport
│     └─ div [DIV#tp-box.teleported] "teleported content"
└─ MultiRoot (src/components/MultiRoot.vue)
   └─ Fragment
      ├─ p [P#mr-1] "root one"
      └─ p [P#mr-2] "root two"
```

A component's own root-element line is elided (its DOM already appears in the component's `[DOM]` bracket); multi-root components show a `Fragment` node.

### JSON output (`--json`)

stdout is always a **single line of JSON** (errors included):

```json
{"ok":true,"command":"tree","page":{"title":"…","url":"…"},
 "vue":{"version":"3.5.42","apps":1,"truncated":false},
 "data":{"roots":[{"name":"App","kind":"component","file":"src/App.vue",
   "dom":{"tag":"div","id":"app"},
   "props":{"msg":"hi"},
   "setupState":{"count":3},
   "children":[…]}]}}
```

Error envelope: `{"ok":false,"error":{"code":"no-vue|vue2|not-found|bad-query|no-browser|ambiguous-tab|bad-tab|…","message":"…","hint":"…"}}`.

**Exit codes**: `0` success / `1` runtime error / `2` usage error. With `--json`, the error JSON goes to stdout and the human-readable explanation to stderr.

## Limits and caveats

- **Vue 3 only** (Vue 2 is detected and reported as `vue2`; the probe is pluggable — contributions welcome).
- **Production builds**: no `__file`, component names may be minified (fall back to the file name or `Anonymous`), and script-setup computeds are not identifiable (the same limitation vue-devtools has). Dev builds give the richest output; point the tool at your dev server.
- **iframes**: main frame only.
- **Huge pages**: tree node cap of 5000 — `truncated: true` when hit; `--depth` has no upper limit (default 8). For deep content, use `inspect`/`query` with XPath or text matching instead of the tree.
- **KeepAlive** cached components are not expanded (cycle guard); **Suspense** only walks the resolved branch.
- **Page still loading** → `no-vue` error (retry in a moment); no automatic retry.
- Reading computed values triggers their getters (should be side-effect-free — standard practice for component inspection tools).

## Development

```bash
npm install
npm run build          # typecheck + esbuild bundle to dist/cli.js
npm run test           # unit tests (ws.Server for the CDP layer; jsdom + Vue runtime for the probe)
npm run test:e2e       # E2E: real headless Chrome + Vite dev fixture (requires local Chrome)
npm run fixture:serve  # serve the fixture dev server manually (port 4173)
```

Architecture: `src/cdp/` (minimal CDP client, endpoint discovery, tab attach), `src/probe/probe.js` (the injected page probe, embedded into the bundle as a string at build time), `src/commands/` (tree/inspect/find/query/style), `src/output/text.ts` (text rendering).

## Roadmap

- Vue 2 support (probe adapter layer already in place)
- iframe / shadow DOM traversal
- Live emitted-event stream
- MCP server mode

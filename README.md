# agent-vuetools

Inspect Vue 3 components in a live browser over CDP — no vue-devtools extension needed. Built for AI agents: stable machine-readable output, plus a human-readable text format.

[![npm version](https://img.shields.io/npm/v/%40adamancyzhang%2Fagent-vuetools)](https://www.npmjs.com/package/@adamancyzhang/agent-vuetools)
[![license](https://img.shields.io/npm/l/%40adamancyzhang%2Fagent-vuetools)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](package.json)

## What it does

The Vue 3 runtime exposes `__vue_app__` / `__vueParentComponent` markers on DOM elements. agent-vuetools connects to the browser via the Chrome DevTools Protocol (CDP), injects a probe script that walks component instances (`subTree` → `component.props` / `setupState` / `computed` / `__file`), serializes cycle-safely in-page, and returns the result as JSON or a text tree.

```bash
agent-vuetools tree                      # component tree of the page
agent-vuetools inspect Counter --json    # props, setup state, computed of one component
agent-vuetools query '//a[contains(@class, "nav")]'   # collect DOM matches + owning components
agent-vuetools style '#submit-btn'       # computed style of an element
```

## Installation

### Global (recommended)

```bash
npm install -g @adamancyzhang/agent-vuetools
```

Requires Node >= 18. No other dependencies — the only runtime dependency is `ws`.

### From source

```bash
git clone https://github.com/adamancyzhang/agent-vuetools.git
cd agent-vuetools
npm install
npm run build
npm link
```

### Requirements

A Chrome/Edge with a debugging port (default `127.0.0.1:9222`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

That's it. Open your Vue page (dev server recommended for the richest output) and run any command.

## Quick Start

```bash
agent-vuetools tree                        # component tree
agent-vuetools inspect Counter             # deep-dive by component name
agent-vuetools inspect src/components/     # by __file path substring
agent-vuetools inspect "#submit-btn"       # by CSS selector
agent-vuetools inspect '//*[text()[contains(., "Submit")]]'   # by XPath
agent-vuetools inspect "Back to list"      # by visible text
agent-vuetools find NavLink                # locate + parent chains
agent-vuetools query '.nav a' --limit 20   # collect DOM matches
agent-vuetools style '.ant-btn-primary'    # computed style + full class
```

## Commands

### tree

```
agent-vuetools tree [--depth N] [--fields ...] [--compact] [--json]
```

Prints the component + element tree. Component nodes carry a `[DOM]` bracket, prop values, a setup-state summary, and the `__file` path (dev builds).

| Flag | Description |
|---|---|
| `--depth <n>` | Max tree depth. Default 8, no upper limit (5000-node cap still applies) |
| `--fields <list>` | Comma-separated: `props,setupState,computed,data,exposed,attrs,slots,emitted,provides,file,dom` (default: `props,setupState,file,dom`) |
| `--compact` | Name and DOM only |

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

A component's own root-element line is elided (its DOM is already in the bracket); multi-root components show a `Fragment` node.

### inspect

```
agent-vuetools inspect <query> [--fields ...] [--json]
```

Deep-dives one component. Resolution order: **component name** → `__file` path substring (case-insensitive) → **CSS selector** → **XPath expression** → **visible text**.

Output: prop definitions (type/required/default) + resolved values, setupState (refs unwrapped; script-setup's `props`/`emit`/`expose` bindings are collapsed to `[Props]`/`[Emit]`/`[Expose]` markers), computed, data, exposed, slots, attrs, provides, declared emits, and the parent chain.

```
Counter (src/components/Counter.vue)
  DOM: <div#counter-box>
  Parent chain: App

  props:
    step: 1  (Number, required)
    count: 3  (Number, default 0)
    label: "Count"  (String, default "Count")

  setupState:
    props: "[Props]"
    emit: "[Emit]"
    doubled: 6
    local: 7
```

### find

```
agent-vuetools find <name|path-substring>
```

Locates components in the tree and prints each match with its parent chain:

```
NavLink (src/components/NavLink.vue)
  at: App → Header → NavLink
```

### query

```
agent-vuetools query <xpath|css> [--limit N] [--json]
```

Collects DOM elements (XPath expression or CSS selector). Each match reports the element descriptor plus its owning component (name/`__file`, or null for plain DOM). Capped at 50 matches by default. Works on non-Vue pages too.

```
# 2 of 2 matches for "//button[contains(@class, "q-btn")]"
[BUTTON#q-btn-1.q-btn] "Submit order" — QueryApp
[BUTTON#q-btn-2.q-btn] "Cancel" — QueryApp
```

### style

```
agent-vuetools style <xpath|css> [--all] [--json]
```

Dumps an element's computed style (a curated ~40 layout/typography/color properties by default, `--all` for every property), inline style, and explicit `tag` / `id` / **full untruncated `class`** / `text` fields — the class attribute is the primary hook for style debugging. Works on non-Vue pages too.

```
tag: span
class: "oio-action-content"
text: "Back to member list"
computed style:
  display: inline-block
  position: static
  width: 98px
```

### Selectors

`inspect` resolves its query in a fixed chain (name → `__file` → CSS → XPath → visible text); `query` and `style` accept XPath or CSS directly. XPath expressions are evaluated by the browser's native engine (XPath 1.0).

> `contains(text(), 'q')` only checks the **first** text node — elements whose text is split by template interpolation won't match. To match any direct text node, use `//*[text()[contains(., 'q')]]`. See [skills/agent-vuetools/references/xpath.md](skills/agent-vuetools/references/xpath.md) for the full XPath reference.

## Agent Mode

`--json` prints a single-line envelope on stdout — errors included:

```json
{"ok":true,"command":"tree","page":{"title":"…","url":"…"},
 "vue":{"version":"3.5.42","apps":1,"truncated":false},
 "data":{"roots":[{"name":"App","kind":"component","file":"src/App.vue","dom":{"tag":"div","id":"app"},
   "props":{"msg":"hi"},"setupState":{"count":3},"children":[…]}]}}
```

Error envelope: `{"ok":false,"error":{"code":"…","message":"…","hint":"…"}}` with a stable `code`:

| Code | Meaning |
|---|---|
| `no-vue` | No Vue 3 app on the selected page (may still be loading — retry) |
| `vue2` | Vue 2 detected — not supported |
| `not-found` | No component/element matches the query |
| `bad-query` | Invalid XPath / CSS expression |
| `no-browser` | No reachable CDP endpoint |
| `ambiguous-tab` | Multiple tabs, none selected — error lists them |
| `bad-tab` | `--tab` selector matched nothing |

Exit codes: `0` success / `1` runtime error / `2` usage error. With `--json`, the error JSON goes to stdout and the human-readable explanation to stderr.

## Connecting

1. **`--cdp <port|host:port|http(s)://url|ws(s)://url>`** — explicit debugging endpoint
2. **Fallback probe of `127.0.0.1:9222`**

Multiple tabs: pick with `--tab` (`t1`/`t2`… 1-based, exact title, or URL substring). Prefer URL substrings — `Target.getTargets` order is not guaranteed. With multiple tabs and no `--tab`, the CLI errors and lists the options.

## Browser operations

agent-vuetools inspects but never drives the page. For browser control — opening URLs, clicking, filling forms, screenshots — pair it with [agent-browser](https://github.com/vercel-labs/agent-browser), which manages a Chrome instance over the same CDP protocol:

```bash
npm i -g agent-browser
agent-browser install                  # first time only
agent-browser open http://localhost:5173

agent-vuetools tree --cdp "$(agent-browser get cdp-url)"   # inspect its browser
agent-browser click "#submit"                               # drive the UI
agent-vuetools inspect SubmitButton --cdp "$(agent-browser get cdp-url)" --fields props,setupState,computed
```

`agent-browser get cdp-url` bridges the two tools: it prints the ws URL of agent-browser's Chrome, which agent-vuetools accepts directly via `--cdp`.

## Limits & Caveats

- **Vue 3 only** (Vue 2 → `vue2` error; the probe is pluggable — contributions welcome).
- **Production builds** lose `__file`, component names, and script-setup computed names (fall back to `Anonymous`) — the same limits vue-devtools has. Dev builds give the richest output.
- **iframes**: main frame only. **KeepAlive** cached components are not expanded (cycle guard); **Suspense** only walks the resolved branch.
- **Huge pages**: tree caps at 5000 nodes (`truncated: true`). For deep content, use `inspect`/`query` with XPath or text targeting instead of the tree.
- Reading computed values triggers their getters (side-effect-free by convention — standard for component inspection tools).

## Skill for AI Coding Assistants

Install the agent-vuetools skill with the [skills](https://skills.sh) CLI, directly from GitHub:

```bash
npx skills add adamancyzhang/agent-vuetools
```

The skill is fetched from this repository (`skills/agent-vuetools/SKILL.md`), so it stays up to date automatically. Works with Claude Code, Codex, Cursor, Gemini CLI, and other skills-aware assistants. Do not copy `SKILL.md` from `node_modules` — it will become stale.

Manual install for Claude Code:

```bash
mkdir -p .claude/skills
cp -r skills/agent-vuetools .claude/skills/
```

## Development

```bash
npm install
npm run build          # typecheck + esbuild bundle to dist/cli.js
npm run test           # unit tests (ws.Server for the CDP layer; jsdom + Vue runtime for the probe)
npm run test:e2e       # E2E: real headless Chrome + Vite dev fixture (requires local Chrome)
npm run fixture:serve  # serve the fixture dev server manually (port 4173)
```

Layout: `src/cdp/` (minimal CDP client, endpoint discovery, tab attach) · `src/probe/probe.js` (the injected page probe, embedded into the bundle as a string at build time) · `src/commands/` (tree/inspect/find/query/style) · `src/output/text.ts` (text rendering) · `test/fixtures/vue-app/` (Vite + Vue 3 fixture) · `skills/` (agent skill docs).

## Roadmap

- Vue 2 support (probe adapter layer already in place)
- iframe / shadow DOM traversal
- Live emitted-event stream
- MCP server mode

## License

[MIT](LICENSE) © 2026 Adamancy Zhang

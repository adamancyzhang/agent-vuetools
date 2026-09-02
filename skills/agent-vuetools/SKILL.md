---
name: agent-vuetools
description: Vue 3 component introspection CLI for AI agents. Use when the user needs to inspect or debug Vue components in a running browser — viewing the component tree, checking props, <script setup> setup state, computed values, locating components by name/__file path/CSS selector/XPath/visible text, or debugging element styles. Triggers include requests to "show the component tree", "what props does this component receive", "find the button that says ...", "inspect this Vue component", "where is this component defined", or "debug this element's styles". Works over CDP against any Chrome/Edge with a remote-debugging port; no vue-devtools extension required.
allowed-tools: Bash(agent-vuetools:*)
---

# agent-vuetools

Inspect Vue 3 components (virtual DOM tree, props, `<script setup>` state, computed) in a live browser over CDP — **no vue-devtools extension needed**.

Requires Chrome/Edge running with a debugging port (default: `127.0.0.1:9222`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

## Core workflows

### 1. See the component tree

```bash
agent-vuetools tree                     # full tree: components + elements
agent-vuetools tree --depth 3 --compact # names + DOM only
agent-vuetools tree --json              # machine-readable
```

Component nodes carry `[DOM]` brackets, prop values, a setup-state summary, and the `__file` path. A component's own root element line is elided (its DOM is already in the bracket); multi-root components show a `Fragment` node.

### 2. Inspect a component

```bash
agent-vuetools inspect Counter          # by component name
agent-vuetools inspect src/components/  # by __file path substring
agent-vuetools inspect "#submit-btn"    # by CSS selector
agent-vuetools inspect '//*[text()[contains(., "Submit")]]'  # by XPath
agent-vuetools inspect "Back to list"   # by visible text
```

Output: prop definitions (type/required/default) + resolved values, setupState (refs unwrapped), computed, data, exposed, slots, attrs, provides, declared emits, and the parent chain. Resolution order: component name → `__file` substring → CSS selector → XPath → visible text.

### 3. Locate components in the tree

```bash
agent-vuetools find <name|path-substring>
```

Prints each match with its parent chain (`App → Header → NavLink`).

### 4. Collect DOM matches

```bash
agent-vuetools query '//button[contains(@class, "ant-btn")]'   # XPath
agent-vuetools query '.nav a' --limit 20                        # CSS, 50 by default
```

Each match reports the element descriptor plus its owning component (name/`__file`, or null for plain DOM). Works on non-Vue pages too.

### 5. Debug element styles

```bash
agent-vuetools style '.ant-btn-primary'   # computed style, curated ~40 keys
agent-vuetools style '//button[@id="save"]' --all   # every property
```

Output includes explicit `tag` / `id` / **full untruncated `class`** / `text` fields plus inline style — the class attribute is the primary hook for style debugging. Works on non-Vue pages too.

## Commands

| Command | Purpose |
|---|---|
| `tree [--depth N] [--fields ...] [--compact]` | Component + element tree (`--depth` default 8, no upper limit; 5000-node cap) |
| `inspect <query> [--fields ...]` | Deep-dive one component: name, `__file` substring, CSS, XPath, or visible text |
| `find <name\|path>` | Locate components in the tree, print parent chains |
| `query <xpath\|css> [--limit N]` | Collect DOM elements with their owning components |
| `style <xpath\|css> [--all]` | Computed style + explicit tag/id/class/text of an element |

Common flags: `--cdp <port|url>` · `--tab <t1|title|url-substring>` · `--json` · `--fields props,setupState,computed,data,exposed,attrs,slots,emitted,provides,file,dom`

## Connecting

1. Explicit `--cdp <port|host:port|http(s)://url|ws(s)://url>`
2. Fallback probe of `127.0.0.1:9222`

Multiple tabs without `--tab` → error listing the options. Prefer URL-substring `--tab` over positional `t1`/`t2` (target order is not guaranteed).

## JSON mode

`--json` prints a single-line envelope on stdout (errors included):

```json
{"ok":true,"command":"tree","page":{"title":"…","url":"…"},"vue":{"version":"3.5.42","apps":1,"truncated":false},"data":{"roots":[…]}}
```

Errors: `{"ok":false,"error":{"code":"no-vue|vue2|not-found|bad-query|no-browser|ambiguous-tab|bad-tab|…","message":"…"}}`. Exit codes: `0` success / `1` runtime error / `2` usage error.

## Limits

- **Vue 3 only** (Vue 2 → `vue2` error). Dev builds give the richest output: `__file` paths, script-setup computed names. In production builds these degrade (`Anonymous`, no computed names) — same limits as vue-devtools.
- **iframes**: main frame only. **KeepAlive** cached components are not expanded; **Suspense** only walks the resolved branch.
- Huge pages: tree caps at 5000 nodes (`truncated: true`); prefer `inspect`/`query` XPath or text targeting for deep content.
- Page still loading → `no-vue`; retry in a moment.

## References

- [references/xpath.md](references/xpath.md) — XPath 1.0 syntax reference for `inspect`/`query`/`style`

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KeepAlive,
  Teleport,
  computed,
  createApp,
  defineComponent,
  h,
  reactive,
  ref,
} from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';

const probeSource = readFileSync(resolve(process.cwd(), 'src/probe/probe.js'), 'utf8');
// Indirect eval runs in global scope so `document` resolves against jsdom.
const probe = (0, eval)(probeSource) as (task: Record<string, unknown>) => string;

function run(task: Record<string, unknown>): any {
  const raw = probe(task);
  const parsed = JSON.parse(raw) as { ok: boolean; data?: unknown; error?: { code: string; message: string; stack?: string } };
  if (!parsed.ok) {
    throw new Error(`probe error [${parsed.error!.code}]: ${parsed.error!.message}\n${parsed.error!.stack ?? ''}`);
  }
  return parsed.data;
}

function mount(component: any, container: string): void {
  createApp(component).mount(container);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="app2"></div>';
});

// ---- test components ---------------------------------------------------------

const HelloWorld = defineComponent({
  name: 'HelloWorld',
  props: {
    greeting: { type: String, default: 'Hello' },
    count: { type: Number, required: true },
  },
  setup(props, { emit }) {
    const doubled = computed(() => props.count * 2);
    const user = reactive({ name: 'Ada', roles: ['admin', 'dev'] });
    const local = ref(3);
    const fn = () => 'x';
    return { doubled, user, local, fn, emit };
  },
  render() {
    return h('div', { id: 'hw' }, [
      h('p', { class: 'greet' }, this.greeting),
      h('button', { onClick: () => this.$emit('click', 1) }, 'push'),
    ]);
  },
});

const App = defineComponent({
  name: 'App',
  setup() {
    const title = ref('Agent VueTools');
    return { title };
  },
  render() {
    return h('div', { id: 'app-root' }, [h(HelloWorld, { greeting: 'Hi', count: 3 })]);
  },
});

const FragmentComp = defineComponent({
  name: 'FragmentComp',
  render() {
    return [h('p', { id: 'f1' }, 'one'), h('p', { id: 'f2' }, 'two')];
  },
});

const TeleportComp = defineComponent({
  name: 'TeleportComp',
  render() {
    return h(Teleport, { to: 'body' }, [h('div', { id: 'tp' }, 'teleported')]);
  },
});

const KeepAliveChild = defineComponent({
  name: 'KeepAliveChild',
  render: () => h('span', { id: 'ka-child' }, 'cached'),
});

const KeepAliveComp = defineComponent({
  name: 'KeepAliveComp',
  render() {
    return h(KeepAlive, null, [h(KeepAliveChild)]);
  },
});

// ---- tree --------------------------------------------------------------------

describe('probe tree', () => {
  it('builds the component tree with props, setupState and computed', () => {
    mount(App, '#app');
    const data = run({ command: 'tree', depth: 8 });

    expect(data.apps).toBe(1);
    expect(data.version).toMatch(/^3\./);
    expect(data.truncated).toBe(false);

    const root = data.roots[0];
    expect(root.kind).toBe('component');
    expect(root.name).toBe('App');
    expect(root.setupState).toEqual({ title: 'Agent VueTools' });

    // Root's direct children: the root element (depth 0), which holds HelloWorld (depth 1).
    const rootEl = root.children[0];
    expect(rootEl).toMatchObject({ kind: 'element', name: 'div' });
    expect(rootEl.dom).toMatchObject({ tag: 'div', id: 'app-root' });

    const hw = rootEl.children[0];
    expect(hw.kind).toBe('component');
    expect(hw.name).toBe('HelloWorld');
    // props are resolved values (tree mode = flat, no defs)
    expect(hw.props).toEqual({ greeting: 'Hi', count: 3 });
    // refs unwrapped, reactive serialized, functions marked
    expect(hw.setupState.local).toBe(3);
    expect(hw.setupState.user).toEqual({ name: 'Ada', roles: ['admin', 'dev'] });
    expect(hw.setupState.fn).toMatch(/^\[Function: fn\]$/);
    // computed resolved from setupState's ComputedRefs
    expect(hw.computed).toEqual({ doubled: 6 });
    // HelloWorld's own root element is included in the tree
    const hwEl = hw.children[0];
    expect(hwEl).toMatchObject({ kind: 'element', name: 'div' });
    expect(hwEl.dom.id).toBe('hw');
    const button = hwEl.children.find((n: any) => n.name === 'button');
    expect(button.dom.text).toBe('push');
  });

  it('handles multiple apps (multi-root / micro-frontends)', () => {
    mount(App, '#app');
    mount(FragmentComp, '#app2');
    const data = run({ command: 'tree', depth: 8 });
    expect(data.apps).toBe(2);
    expect(data.roots.map((r: any) => r.name)).toEqual(['App', 'FragmentComp']);
  });

  it('walks fragments (multi-root components)', () => {
    mount(FragmentComp, '#app');
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    // Fragment root: component dom is null, children is a fragment node
    expect(root.dom).toBeNull();
    const frag = root.children[0];
    expect(frag.kind).toBe('fragment');
    expect(frag.children.map((c: any) => c.dom.id)).toEqual(['f1', 'f2']);
  });

  it('walks teleported content', () => {
    mount(TeleportComp, '#app');
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    const teleport = root.children[0];
    // Vue >= 3.5 renders Teleport as a plain vnode (no component instance).
    expect(teleport.kind).toBe('component');
    expect(teleport.name).toBe('Teleport');
    expect(teleport.noInstance).toBe(true);
    expect(teleport.children[0]).toMatchObject({ kind: 'element', name: 'div' });
    expect(teleport.children[0].dom.id).toBe('tp');
  });

  it('walks KeepAlive without looping', () => {
    mount(KeepAliveComp, '#app');
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    const ka = root.children[0];
    expect(ka.name).toBe('KeepAlive');
    const child = ka.children[0];
    expect(child.name).toBe('KeepAliveChild');
    expect(child.dom.id).toBe('ka-child');
  });

  it('respects the depth cap and flags truncation', () => {
    mount(App, '#app');
    // depth 1 = root + subTree + direct children; anything deeper is cut
    const shallow = run({ command: 'tree', depth: 1 });
    const div = shallow.roots[0].children[0];
    expect(div.name).toBe('div');
    expect(div.children[0].name).toBe('HelloWorld');
    expect(div.children[0].children).toBeUndefined();
    expect(shallow.truncated).toBe(true);

    // depth 2 = one level deeper (HelloWorld's own subTree)
    const deep = run({ command: 'tree', depth: 2 });
    expect(deep.roots[0].children[0].children[0].children.length).toBeGreaterThan(0);
  });

  it('honors the fields whitelist', () => {
    mount(App, '#app');
    const data = run({ command: 'tree', depth: 8, fields: ['props'] });
    const hw = data.roots[0].children[0].children[0];
    expect(hw.props).toEqual({ greeting: 'Hi', count: 3 });
    expect(hw.setupState).toBeUndefined();
    expect(hw.computed).toBeUndefined();
  });
});

// ---- inspect -----------------------------------------------------------------

describe('probe inspect', () => {
  it('matches by component name and returns full detail', () => {
    mount(App, '#app');
    const data = run({ command: 'inspect', query: 'HelloWorld', detail: true });
    expect(data.query).toBe('HelloWorld');
    expect(data.instances).toHaveLength(1);
    const inst = data.instances[0];
    expect(inst.name).toBe('HelloWorld');
    expect(inst.props.defs).toEqual({
      greeting: { type: ['String'], default: 'Hello' },
      count: { type: ['Number'], required: true },
    });
    expect(inst.props.values).toEqual({ greeting: 'Hi', count: 3 });
    expect(inst.computed).toEqual({ doubled: 6 });
    expect(inst.setupState.user.name).toBe('Ada');
    expect(inst.parentChain).toEqual([{ name: 'App', file: null }]);
    expect(inst.dom).toMatchObject({ tag: 'div', id: 'hw' });
  });

  it('matches by __file path substring', () => {
    (HelloWorld as any).__file = 'src/components/HelloWorld.vue';
    try {
      mount(App, '#app');
      const data = run({ command: 'inspect', query: 'components/HelloWorld.vue', detail: true });
      expect(data.instances[0].name).toBe('HelloWorld');
      expect(data.instances[0].file).toBe('src/components/HelloWorld.vue');
    } finally {
      delete (HelloWorld as any).__file;
    }
  });

  it('matches by CSS selector', () => {
    mount(App, '#app');
    const data = run({ command: 'inspect', query: '#hw', detail: true });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('HelloWorld');
  });

  it('matches components by visible text', () => {
    const TextBtn = defineComponent({
      name: 'TextBtn',
      render: () => h('button', { id: 'back-btn' }, 'Back to member list'),
    });
    const TextApp = defineComponent({
      name: 'TextApp',
      render: () => h('div', [h(TextBtn)]),
    });
    mount(TextApp, '#app');
    const data = run({ command: 'inspect', query: 'Back to member list' });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('TextBtn');
  });

  it('dedupes text matches that resolve to the same component', () => {
    const NestedText = defineComponent({
      name: 'NestedText',
      render: () => h('button', [h('span', 'Submit order')]),
    });
    const NestedApp = defineComponent({
      name: 'NestedApp',
      render: () => h('div', [h(NestedText)]),
    });
    mount(NestedApp, '#app');
    // both <button> and <span> carry the text — one component, one match
    const data = run({ command: 'inspect', query: 'Submit order' });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('NestedText');
  });

  it('returns every match for a repeated component name', () => {
    const Twice = defineComponent({
      name: 'Twice',
      render: () => h('span'),
    });
    const TwiceApp = defineComponent({
      name: 'TwiceApp',
      render: () => h('div', [h(Twice), h(Twice)]),
    });
    mount(TwiceApp, '#app');
    const data = run({ command: 'inspect', query: 'Twice' });
    expect(data.instances).toHaveLength(2);
  });

  it('matches by XPath', () => {
    mount(App, '#app');
    const data = run({ command: 'inspect', query: '//p[@class="greet"]', detail: true });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('HelloWorld');
  });

  it('fails with not-found for unknown queries', () => {
    mount(App, '#app');
    const raw = probe({ command: 'inspect', query: 'Nope' });
    const parsed = JSON.parse(raw);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('not-found');
  });
});

// ---- query (XPath / CSS collection) ------------------------------------------

describe('probe query', () => {
  const QueryApp = defineComponent({
    name: 'QueryApp',
    render: () =>
      h('div', { id: 'qa' }, [
        h('button', { id: 'q-btn-1', class: 'q-btn' }, 'Submit order'),
        h('button', { id: 'q-btn-2', class: 'q-btn' }, 'Cancel'),
        h('span', { class: 'plain' }, 'Plain text'),
      ]),
  });

  beforeEach(() => {
    mount(QueryApp, '#app');
  });

  it('collects XPath matches with their owning components', () => {
    const data = run({ command: 'query', query: '//button[contains(@class, "q-btn")]' });
    expect(data.total).toBe(2);
    expect(data.truncated).toBe(false);
    expect(data.matches).toHaveLength(2);
    expect(data.matches[0]).toMatchObject({
      dom: { tag: 'button', id: 'q-btn-1' },
      component: { name: 'QueryApp' },
    });
  });

  it('collects CSS selector matches and respects the limit', () => {
    const data = run({ command: 'query', query: 'button', limit: 1 });
    expect(data.total).toBe(2);
    expect(data.truncated).toBe(true);
    expect(data.matches).toHaveLength(1);
  });

  it('reports null components for elements outside any Vue tree', () => {
    const plain = document.createElement('span');
    plain.className = 'plain-outside';
    plain.textContent = 'Outside';
    document.body.appendChild(plain);
    const data = run({ command: 'query', query: '//span[@class="plain-outside"]' });
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].component).toBeNull();
  });

  it('reports bad-query for invalid expressions', () => {
    const parsed = JSON.parse(probe({ command: 'query', query: '//[invalid' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('bad-query');
  });
});

// ---- style --------------------------------------------------------------------

describe('probe style', () => {
  it('dumps computed style, inline style and explicit identity fields', () => {
    const Styled = defineComponent({
      name: 'Styled',
      render: () =>
        h('button', { id: 'styled-btn', class: 'btn btn-primary active', style: { color: 'red', padding: '4px' } }, 'Click me'),
    });
    mount(Styled, '#app');
    const data = run({ command: 'style', query: '#styled-btn' });
    expect(data.tag).toBe('button');
    expect(data.id).toBe('styled-btn');
    expect(data.class).toBe('btn btn-primary active'); // full, untruncated
    expect(data.text).toBe('Click me');
    expect(data.style.color).toBe('rgb(255, 0, 0)');
    expect(data.style.padding).toBe('4px');
    expect(data.inline).toContain('color');
  });

  it('does not truncate long class attributes', () => {
    const long = Array.from({ length: 20 }, () => 'verylongclassname').join(' ');
    const Styled = defineComponent({
      name: 'StyledLong',
      render: () => h('button', { class: long }, 'x'),
    });
    mount(Styled, '#app');
    const data = run({ command: 'style', query: 'button' });
    expect(data.class).toBe(long); // full length
    expect(data.class!.length).toBe(long.length);
  });

  it('supports XPath target expressions', () => {
    const Styled = defineComponent({
      name: 'Styled2',
      render: () => h('button', { id: 'styled-btn2', style: { color: 'blue' } }, 'Click me'),
    });
    mount(Styled, '#app');
    const data = run({ command: 'style', query: '//button[@id="styled-btn2"]' });
    expect(data.style.color).toBe('rgb(0, 0, 255)');
  });

  it('fails with not-found for unknown targets', () => {
    const parsed = JSON.parse(probe({ command: 'style', query: '#missing' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('not-found');
  });
});

// ---- errors and serialization -------------------------------------------------

describe('probe errors and serialization', () => {
  it('reports no-vue on a Vue-free page', () => {
    const parsed = JSON.parse(probe({ command: 'tree' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('no-vue');
  });

  it('reports vue2 when a Vue 2 marker is present', () => {
    const el = document.createElement('div');
    (el as any).__vue__ = {};
    document.body.appendChild(el);
    const parsed = JSON.parse(probe({ command: 'tree' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('vue2');
    expect(parsed.error.message).toMatch(/Vue 2/);
  });

  it('serializes circular references safely', () => {
    const Circular = defineComponent({
      name: 'Circular',
      setup() {
        const a: any = { label: 'loop' };
        a.self = a;
        return { a };
      },
      render: () => h('div'),
    });
    mount(Circular, '#app');
    const data = run({ command: 'tree', depth: 1 });
    expect(data.roots[0].setupState.a).toEqual({ label: 'loop', self: '[Circular]' });
  });

  it('serializes shared (non-cyclic) references without false positives', () => {
    const Shared = defineComponent({
      name: 'Shared',
      setup() {
        const common = { x: 1 };
        return { a: common, b: common };
      },
      render: () => h('div'),
    });
    mount(Shared, '#app');
    const data = run({ command: 'tree', depth: 1 });
    expect(data.roots[0].setupState).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });
});

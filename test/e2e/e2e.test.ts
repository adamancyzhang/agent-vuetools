// End-to-end: built CLI against real headless Chrome + the Vite dev fixture.
// The fixture runs `vite dev` so assertions can rely on dev-build features
// (__file paths, computed names) — the realistic agent scenario.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CdpClient } from '../../src/cdp/client.js';
import { launchChrome, until, type LaunchedChrome } from './launch-chrome.js';

const execFileAsync = promisify(execFile);

const CLI = resolve(process.cwd(), 'dist/cli.js');
const FIXTURE_URL = 'http://127.0.0.1:4173/';

let viteProc: ChildProcess | undefined;
let chrome: LaunchedChrome | undefined;

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function cli(args: string[]): Promise<CliResult> {
  try {
    const r = await execFileAsync('node', [CLI, ...args], { timeout: 30_000 });
    return { stdout: r.stdout, stderr: r.stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: typeof err.code === 'number' ? err.code : 1 };
  }
}

async function cliJson(args: string[]): Promise<{ parsed: any; raw: CliResult }> {
  const raw = await cli([...args, '--json']);
  return { parsed: JSON.parse(raw.stdout), raw };
}

/** Depth-first walk of tree nodes. */
function walkTree(nodes: any[], cb: (node: any) => void): void {
  for (const n of nodes) {
    cb(n);
    if (n.children) walkTree(n.children, cb);
  }
}

function collect(nodes: any[]): any[] {
  const all: any[] = [];
  walkTree(nodes, (n) => all.push(n));
  return all;
}

beforeAll(async () => {
  // vite dev server for the fixture
  viteProc = spawn(
    resolve(process.cwd(), 'node_modules/.bin/vite'),
    ['dev', 'test/fixtures/vue-app', '--port', '4173', '--strictPort'],
    { stdio: 'ignore' },
  );
  await until(async () => {
    try {
      const res = await fetch(FIXTURE_URL);
      return res.ok;
    } catch {
      return false;
    }
  }, 30_000);

  chrome = await launchChrome(FIXTURE_URL);

  // Wait until Vue is actually mounted (vite compiles on first load).
  await until(async () => {
    const { raw } = await cliJson(['tree', '--cdp', String(chrome!.port)]);
    return raw.code === 0;
  }, 30_000);
}, 180_000);

afterAll(async () => {
  await chrome?.cleanup();
  viteProc?.kill('SIGTERM');
});

describe('tree', () => {
  it('returns the full component tree as JSON', async () => {
    const { parsed, raw } = await cliJson([
      'tree',
      '--cdp',
      String(chrome!.port),
      '--fields',
      'props,setupState,computed,file,dom',
    ]);
    expect(raw.code).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('tree');
    expect(parsed.page.url).toContain('4173');
    expect(parsed.vue.version).toMatch(/^3\./);
    expect(parsed.vue.apps).toBe(2);

    const nodes = collect(parsed.data.roots);
    const byName = (name: string) => nodes.filter((n) => n.name === name);

    const app = byName('App')[0];
    expect(app.kind).toBe('component');
    expect(app.file).toContain('App.vue');
    expect(app.setupState.title).toBe('agent-vuetools fixture');

    const counter = byName('Counter')[0];
    expect(counter.props).toEqual({ step: 1, count: 3, label: 'Count' });
    expect(counter.setupState.doubled).toBe(6);
    expect(counter.setupState.props).toBe('[Props]');
    expect(counter.computed).toEqual({ doubled: 6 });

    expect(byName('TeleportBox')).toHaveLength(1);
    expect(nodes.some((n) => n.name === 'Teleport')).toBe(true);
    expect(byName('MultiRoot')).toHaveLength(1);
    // v-for produces three Item instances
    expect(byName('Item')).toHaveLength(3);

    const otherApp = byName('OtherApp')[0];
    expect(otherApp.setupState.msg).toBe('second app');
    expect(parsed.vue.truncated).toBe(false);
  });

  it('supports browser-level ws URLs with --tab selection', async () => {
    const { parsed, raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 't1', '--depth', '3']);
    expect(raw.code).toBe(0);
    expect(parsed.page.title).toBe('agent-vuetools fixture');
  });

  it('renders a human-readable text tree', async () => {
    const res = await cli(['tree', '--cdp', String(chrome!.port), '--depth', '4']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('└─ App');
    expect(res.stdout).toContain('Counter');
    expect(res.stdout).toContain('[DIV#counter-box]');
  });
});

describe('inspect', () => {
  it('dumps props definitions, setup state and computed by component name', async () => {
    const { parsed } = await cliJson(['inspect', 'Counter', '--cdp', String(chrome!.port)]);
    const inst = parsed.data.instances[0];
    expect(inst.name).toBe('Counter');
    expect(inst.file).toContain('components/Counter.vue');
    expect(inst.props.defs.step).toMatchObject({ type: ['Number'], required: true });
    expect(inst.props.defs.count).toMatchObject({ type: ['Number'], default: 0 });
    expect(inst.props.values).toEqual({ step: 1, count: 3, label: 'Count' });
    expect(inst.computed).toEqual({ doubled: 6 });
    expect(inst.declaredEmits).toEqual(['change']);
    expect(inst.parentChain.map((p: any) => p.name)).toEqual(['App']);
  });

  it('matches by __file path substring', async () => {
    const { parsed } = await cliJson(['inspect', 'components/Counter.vue', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });

  it('matches by CSS selector', async () => {
    const { parsed } = await cliJson(['inspect', '#count-btn', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });

  it('fails with not-found for unknown queries', async () => {
    const { raw } = await cliJson(['inspect', 'NopeNope', '--cdp', String(chrome!.port)]);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('not-found');
  });
});

describe('find', () => {
  it('locates components by name and reports parent chains', async () => {
    const { parsed } = await cliJson(['find', 'HelloWorld', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches).toHaveLength(1);
    expect(parsed.data.matches[0].path.map((p: any) => p.name)).toEqual(['App', 'HelloWorld']);
  });

  it('matches file-path substrings', async () => {
    const { parsed } = await cliJson(['find', 'components/', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches.length).toBeGreaterThanOrEqual(5);
    expect(parsed.data.matches.some((m: any) => m.name === 'Item')).toBe(true);
  });
});

describe('query (XPath / CSS collection)', () => {
  it('collects XPath matches with owning components', async () => {
    const { parsed } = await cliJson(['query', '//button', '--cdp', String(chrome!.port)]);
    expect(parsed.ok).toBe(true);
    const countBtn = parsed.data.matches.find((m: any) => m.dom?.id === 'count-btn');
    expect(countBtn.component.name).toBe('Counter');
    expect(parsed.data.total).toBeGreaterThanOrEqual(2);
  });

  it('collects CSS selector matches', async () => {
    const { parsed } = await cliJson(['query', '.greet', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches[0].component.name).toBe('HelloWorld');
  });
});

describe('style', () => {
  it('dumps computed style with explicit class for a CSS selector', async () => {
    const { parsed } = await cliJson(['style', '.greet', '--cdp', String(chrome!.port)]);
    expect(parsed.data.tag).toBe('p');
    expect(parsed.data.class).toBe('greet'); // full class attribute, explicit field
    expect(parsed.data.style).toHaveProperty('display');
    expect(parsed.data.style).toHaveProperty('color');
  });

  it('supports XPath targets', async () => {
    const { parsed } = await cliJson(['style', '//span[@id="doubled"]', '--cdp', String(chrome!.port)]);
    expect(parsed.data.id).toBe('doubled');
    expect(parsed.data.class).toBeNull();
  });
});

describe('inspect by XPath', () => {
  it('resolves the owning component of an XPath match', async () => {
    const { parsed } = await cliJson(['inspect', '//button[@id="count-btn"]', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });
});

describe('non-Vue pages and tab selection', () => {
  it('reports no-vue on a plain page (second tab)', async () => {
    // Open a second tab with the plain page via the browser-level connection.
    const client = await CdpClient.connect(chrome!.browserWs, { timeoutMs: 10_000 });
    try {
      await client.send('Target.createTarget', { url: `${FIXTURE_URL}plain.html` });
    } finally {
      client.close();
    }
    // Target.getTargets order is not guaranteed — select by URL substring.
    const { raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 'plain.html']);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('no-vue');
  }, 60_000);

  it('rejects a bad --tab selector with a helpful error', async () => {
    const { raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 't99']);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.error.code).toBe('bad-tab');
  });

  it('runs DOM queries on non-Vue pages too', async () => {
    const { parsed } = await cliJson(['query', '//div[@id="not-vue"]', '--cdp', chrome!.browserWs, '--tab', 'plain.html']);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.matches[0].component).toBeNull();
  });
});

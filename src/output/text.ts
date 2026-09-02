import type { Field } from '../fields.js';
import type { DomInfo, TreeNode, TreeProbeData } from '../commands/tree.js';
import type { InspectResult } from '../commands/inspect.js';
import type { FindResult } from '../commands/find.js';
import type { QueryResult } from '../commands/query.js';
import type { StyleResult } from '../commands/style.js';

const LINE_LIMIT = 160;
const VALUE_LIMIT = 200;

export function truncateLine(s: string): string {
  return s.length > LINE_LIMIT ? s.slice(0, LINE_LIMIT - 1) + '…' : s;
}

/** Format a serialized value compactly: strings quoted, objects as JSON. */
export function fmtValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = JSON.stringify(v);
  return s.length > VALUE_LIMIT ? s.slice(0, VALUE_LIMIT - 1) + '…' : s;
}

function pairs(obj: unknown, sep: string): string {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .map(([k, v]) => `${k}${sep}${fmtValue(v)}`)
    .join(', ');
}

/** [DIV#app.main] with leaf text: [P.foo] "hi". Comment anchors render nothing. */
export function domLabel(dom: DomInfo | null | undefined): string {
  if (!dom || dom.tag === '#comment') return '';
  const cls = dom.class ? '.' + dom.class.replace(/\s+/g, '.') : '';
  const id = dom.id ? '#' + dom.id : '';
  const text = dom.text ? ` "${dom.text}"` : '';
  return `[${dom.tag.toUpperCase()}${id}${cls}]${text}`;
}

const GROUP_LABEL: Record<string, string> = {
  setupState: 'setup',
  emitted: 'emits',
};

function groupLabel(field: Field, node: TreeNode): string | null {
  switch (field) {
    case 'props': {
      if (!node.props || typeof node.props !== 'object') return null;
      const p = pairs(node.props, ': ');
      return p ? `{${p}}` : null;
    }
    case 'setupState':
    case 'computed':
    case 'data':
    case 'exposed':
    case 'attrs':
    case 'provides': {
      const v = node[field];
      if (!v || typeof v !== 'object') return null;
      const p = pairs(v, '=');
      return p ? `{${GROUP_LABEL[field] ?? field}: ${p}}` : null;
    }
    case 'slots':
      return node.slots?.length ? `{slots: [${node.slots.join(', ')}]}` : null;
    case 'emitted':
      return node.declaredEmits?.length ? `{emits: [${node.declaredEmits.join(', ')}]}` : null;
    case 'file':
    case 'dom':
      return null; // rendered separately
  }
}

export interface TextOpts {
  fields: Field[];
  compact: boolean;
}

function nodeLabel(node: TreeNode, opts: TextOpts): string | null {
  switch (node.kind) {
    case 'component': {
      const parts: string[] = [node.name];
      if (!opts.compact) {
        for (const f of opts.fields) {
          const g = groupLabel(f, node);
          if (g) parts.push(g);
        }
      }
      const dom = opts.compact || opts.fields.includes('dom') ? domLabel(node.dom) : '';
      if (dom) parts.push(dom);
      if (!opts.compact && opts.fields.includes('file') && node.file) parts.push(`(${node.file})`);
      return truncateLine(parts.join(' '));
    }
    case 'element': {
      const parts: string[] = [node.name];
      if (opts.compact || opts.fields.includes('dom')) {
        const dom = domLabel(node.dom);
        if (dom) parts.push(dom);
      }
      if (!opts.compact && node.props && typeof node.props === 'object') {
        const p = pairs(node.props, ': ');
        if (p) parts.push(`{${p}}`);
      }
      return truncateLine(parts.join(' '));
    }
    case 'text':
    case 'comment':
      return null; // leaf text lives in the DOM bracket; comments are noise
    default:
      return truncateLine(node.name); // fragment / static / unknown
  }
}

/** Render one app root's tree (handles component root-element elision). */
function renderNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  out: string[],
  opts: TextOpts,
): void {
  const label = nodeLabel(node, opts);
  if (label) out.push(prefix + (isLast ? '└─ ' : '├─ ') + label);

  let kids = node.children ?? [];
  // A component's own root element duplicates its DOM bracket — skip the
  // element line and render its children flat, at the component's own level.
  let elided = false;
  if (
    node.kind === 'component' &&
    !node.noInstance &&
    !node.duplicate &&
    node.dom &&
    kids.length > 0 &&
    kids[0]!.kind === 'element'
  ) {
    const [rootEl, ...rest] = kids;
    kids = [...(rootEl!.children ?? []), ...rest];
    elided = true;
  }

  // text/comment nodes render no line (and have no children) — drop them so
  // they don't consume the last-child glyph.
  kids = kids.filter((k) => nodeLabel(k, opts) !== null);

  const childPrefix = elided ? prefix : prefix + (isLast ? '   ' : '│  ');
  kids.forEach((k, i) => renderNode(k, childPrefix, i === kids.length - 1, out, opts));
}

export function renderTreeText(
  vue: TreeProbeData,
  flags: { compact?: boolean },
  fields: Field[],
): string {
  const out: string[] = [];
  if (vue.truncated) out.push('# tree truncated (depth or node limit reached)');
  if (vue.apps > 1) out.push(`# ${vue.apps} Vue apps found on this page`);
  const opts: TextOpts = { fields, compact: !!flags.compact };
  vue.roots.forEach((root, i) => {
    if (i > 0) out.push('');
    renderNode(root, '', true, out, opts);
  });
  return out.join('\n');
}

// ---- inspect ---------------------------------------------------------------

function section(values: Record<string, unknown> | undefined, indent: string): string[] {
  if (!values || typeof values !== 'object') return [];
  return Object.entries(values).map(([k, v]) => `${indent}${k}: ${fmtValue(v)}`);
}

function renderInspectInstance(inst: InspectResult['data']['instances'][number], fields: Field[]): string {
  const out: string[] = [];
  const head = inst.file ? `${inst.name} (${inst.file})` : inst.name;
  out.push(head);
  if (fields.includes('dom') && inst.dom) {
    const d = inst.dom;
    const cls = d.class ? '.' + d.class.replace(/\s+/g, '.') : '';
    const id = d.id ? '#' + d.id : '';
    out.push(`  DOM: <${d.tag.toLowerCase()}${id}${cls}>`);
  }
  if (inst.parentChain.length) {
    out.push(`  Parent chain: ${inst.parentChain.map((p) => p.name).join(' → ')}`);
  }
  const show = (f: Field) => fields.includes(f);
  if (show('props') && inst.props) {
    const defs = inst.props.defs as Record<string, { type?: string[]; required?: boolean; default?: unknown }> | undefined;
    const values = inst.props.values as Record<string, unknown> | undefined;
    if (Object.keys(values ?? {}).length) {
      out.push('', '  props:');
      for (const k of Object.keys(values ?? {})) {
        const d = defs?.[k];
        let annot = '';
        if (d) {
          const bits: string[] = [];
          if (d.type?.length) bits.push(d.type.join(' | '));
          if (d.required) bits.push('required');
          if (d.default !== undefined) bits.push(`default ${fmtValue(d.default)}`);
          if (bits.length) annot = `  (${bits.join(', ')})`;
        }
        out.push(`    ${k}: ${fmtValue(values?.[k])}${annot}`);
      }
    }
  }
  const sectionHeader = (name: string, values: Record<string, unknown> | undefined, indent: string): void => {
    const lines = section(values, indent);
    if (lines.length) out.push('', `  ${name}:`, ...lines);
  };
  if (show('setupState')) sectionHeader('setupState', inst.setupState as Record<string, unknown>, '    ');
  if (show('computed')) sectionHeader('computed', inst.computed, '    ');
  if (show('data')) sectionHeader('data', inst.data as Record<string, unknown>, '    ');
  if (show('exposed')) sectionHeader('exposed', inst.exposed as Record<string, unknown>, '    ');
  if (show('attrs')) sectionHeader('attrs', inst.attrs as Record<string, unknown>, '    ');
  if (show('provides')) sectionHeader('provides', inst.provides as Record<string, unknown>, '    ');
  if (show('slots') && inst.slots?.length) out.push('', `  slots: [${inst.slots.join(', ')}]`);
  if (show('emitted') && inst.declaredEmits?.length) out.push('', `  declaredEmits: [${inst.declaredEmits.join(', ')}]`);
  return out.join('\n');
}

export function renderInspectText(result: InspectResult, fields: Field[]): string {
  return result.data.instances.map((inst) => renderInspectInstance(inst, fields)).join('\n\n');
}

// ---- find ------------------------------------------------------------------

export function renderFindText(result: FindResult): string {
  if (!result.data.matches.length) return 'No matches found.';
  return result.data.matches
    .map((m) => {
      const head = m.file ? `${m.name} (${m.file})` : m.name;
      const path = m.path.map((p) => p.name).join(' → ');
      return `${head}\n  at: ${path}`;
    })
    .join('\n\n');
}

// ---- query -----------------------------------------------------------------

export function renderQueryText(result: QueryResult): string {
  const { matches, total, truncated } = result.data;
  if (!matches.length) return `No elements match "${result.data.query}".`;
  const head = `# ${matches.length} of ${total} match${total === 1 ? '' : 'es'} for "${result.data.query}"${truncated ? ' (capped)' : ''}`;
  const lines = matches.map((m) => {
    const dom = domLabel(m.dom);
    const comp = m.component ? (m.component.file ? `${m.component.name} (${m.component.file})` : m.component.name) : null;
    return truncateLine([dom || '(no element)', comp ? `— ${comp}` : ''].join(' '));
  });
  return [head, ...lines].join('\n');
}

// ---- style -----------------------------------------------------------------

export function renderStyleText(result: StyleResult): string {
  const { tag, id, class: cls, text, inline, style } = result.data;
  const out: string[] = [];
  out.push(`tag: ${tag}`);
  if (id) out.push(`id: "${id}"`);
  if (cls) out.push(`class: "${cls}"`);
  if (text) out.push(`text: "${text}"`);
  if (inline) out.push(`inline: ${inline}`);
  const keys = Object.keys(style);
  if (keys.length) {
    out.push('computed style:');
    for (const k of keys) out.push(`  ${k}: ${style[k]}`);
  }
  return out.join('\n');
}

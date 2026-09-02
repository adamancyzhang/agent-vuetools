import { describe, expect, it } from 'vitest';
import { domLabel, fmtValue, renderTreeText } from '../../src/output/text.js';
import type { TreeNode, TreeProbeData } from '../../src/commands/tree.js';

describe('fmtValue', () => {
  it('quotes strings and compacts objects', () => {
    expect(fmtValue('hi')).toBe('"hi"');
    expect(fmtValue(3)).toBe('3');
    expect(fmtValue(null)).toBe('null');
    expect(fmtValue({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });
});

describe('domLabel', () => {
  it('renders tag, id, class and leaf text', () => {
    expect(domLabel({ tag: 'div', id: 'app' })).toBe('[DIV#app]');
    expect(domLabel({ tag: 'header', class: 'site header' })).toBe('[HEADER.site.header]');
    expect(domLabel({ tag: 'p', text: 'hello' })).toBe('[P] "hello"');
    expect(domLabel(null)).toBe('');
  });
});

describe('renderTreeText', () => {
  const vue: TreeProbeData = {
    version: '3.5.42',
    apps: 1,
    truncated: false,
    roots: [
      {
        kind: 'component',
        name: 'App',
        file: 'src/App.vue',
        dom: { tag: 'div', id: 'app' },
        children: [
          // App's root element — elided, its children rendered one level up
          {
            kind: 'element',
            name: 'div',
            dom: { tag: 'div', id: 'app' },
            children: [
              {
                kind: 'component',
                name: 'Counter',
                file: 'src/components/Counter.vue',
                props: { count: 3 },
                setupState: { doubled: 6 },
                dom: { tag: 'button', id: 'counter' },
                children: [
                  {
                    kind: 'element',
                    name: 'button',
                    dom: { tag: 'button', id: 'counter', text: '6' },
                    children: [{ kind: 'text', name: 'text', children: [] }],
                  },
                ],
              },
            ],
          },
          { kind: 'comment', name: 'comment' },
        ],
      },
    ],
  };

  it('renders the tree with root-element elision and skips comments', () => {
    const out = renderTreeText(vue, {}, ['props', 'setupState', 'file', 'dom']);
    expect(out.split('\n')).toEqual([
      '└─ App [DIV#app] (src/App.vue)',
      '└─ Counter {count: 3} {setup: doubled=6} [BUTTON#counter] (src/components/Counter.vue)',
    ]);
  });

  it('supports --compact (name and DOM only)', () => {
    const out = renderTreeText(vue, { compact: true }, ['props', 'setupState', 'file', 'dom']);
    expect(out.split('\n')[0]).toBe('└─ App [DIV#app]');
  });
});

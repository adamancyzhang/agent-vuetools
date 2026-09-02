/**
 * agent-vuetools page probe (Vue 3).
 *
 * Injected into the inspected page via Runtime.evaluate. Self-contained IIFE
 * that evaluates to a function: probe(task) -> JSON string.
 *
 *   task = { command: 'tree' | 'inspect', depth?, fields?: string[] | null,
 *            detail?: boolean, query?: string }
 *
 * Always returns a JSON string:
 *   success: {"ok":true,"data":{...}}
 *   failure: {"ok":false,"error":{"code","message","stack"?}}
 *
 * Error codes: no-vue | vue2 | not-found | internal
 */
(function () {
  'use strict';

  var MAX_NODES = 5000;
  var MAX_VALUE_DEPTH = 4;
  var MAX_OBJ_KEYS = 30;
  var MAX_ARRAY_ITEMS = 50;
  var TEXT_LIMIT = 80;
  var CLASS_LIMIT = 120;

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function mkErr(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  // ---- serialization -------------------------------------------------------

  function isElement(v) {
    return typeof Node !== 'undefined' && v instanceof Node;
  }

  function isVNode(v) {
    return (
      v !== null &&
      typeof v === 'object' &&
      typeof v.shapeFlag === 'number' &&
      v.type !== undefined
    );
  }

  function isComponentInstance(v) {
    return (
      v !== null &&
      typeof v === 'object' &&
      typeof v.type === 'object' &&
      v.proxy !== undefined &&
      v.subTree !== undefined &&
      v.vnode !== undefined
    );
  }

  /** Component DEFINITION (imported into script setup, etc.) — serialize compactly. */
  function isComponentDef(v) {
    return (
      v !== null &&
      typeof v === 'object' &&
      (typeof v.setup === 'function' || typeof v.render === 'function') &&
      (typeof v.__name === 'string' || typeof v.name === 'string')
    );
  }

  function componentName(type) {
    if (!type) return 'Anonymous';
    if (typeof type.__name === 'string' && type.__name) return type.__name;
    if (typeof type.name === 'string' && type.name) return type.name;
    // Template-only SFCs may lack __name — derive from the dev-mode file path.
    if (typeof type.__file === 'string' && type.__file) {
      var m = /([^/]+)\.vue$/.exec(type.__file);
      if (m) return m[1];
    }
    return 'Anonymous';
  }

  /**
   * Cycle-safe value serializer producing plain JSON-safe data.
   * `seen` is path-scoped (entries removed on exit), so shared sub-objects
   * serialize twice while true cycles become "[Circular]".
   */
  function serializeValue(v, seen, depth) {
    if (v === undefined) return null;
    if (v === null) return null;
    var t = typeof v;
    if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'bigint') return String(v) + 'n';
    if (t === 'symbol') return 'Symbol(' + (v.description || '') + ')';
    if (t !== 'object') return String(v);

    try {
      if (v.__v_isRef) return serializeValue(v.value, seen, depth);
    } catch (e) {
      return '[Error: ' + e.message + ']';
    }
    if (isComponentDef(v)) return '[Component: ' + componentName(v) + ']';
    if (isElement(v)) {
      if (v.nodeType === 3) return '#text';
      return '<' + String(v.tagName || 'node').toLowerCase() + '>';
    }
    if (isVNode(v)) return '[VNode]';
    if (isComponentInstance(v)) return '[ComponentInstance]';
    if (seen.has(v)) return '[Circular]';
    if (depth <= 0) return '[MaxDepth]';

    seen.add(v);
    try {
      var out;
      if (v instanceof Date) {
        out = v.toISOString();
      } else if (v instanceof Map) {
        out = {};
        var i = 0;
        v.forEach(function (val, key) {
          if (i++ >= MAX_OBJ_KEYS) return;
          out[String(key)] = serializeValue(val, seen, depth - 1);
        });
      } else if (v instanceof Set) {
        out = Array.from(v)
          .slice(0, MAX_ARRAY_ITEMS)
          .map(function (x) {
            return serializeValue(x, seen, depth - 1);
          });
      } else if (Array.isArray(v)) {
        out = v.slice(0, MAX_ARRAY_ITEMS).map(function (x) {
          return serializeValue(x, seen, depth - 1);
        });
        if (v.length > MAX_ARRAY_ITEMS) out.push('... +' + (v.length - MAX_ARRAY_ITEMS) + ' more');
      } else {
        out = {};
        var keys = Object.keys(v);
        keys.slice(0, MAX_OBJ_KEYS).forEach(function (k) {
          var val;
          try {
            val = v[k];
          } catch (e) {
            out[k] = '[Error: ' + e.message + ']';
            return;
          }
          out[k] = serializeValue(val, seen, depth - 1);
        });
        if (keys.length > MAX_OBJ_KEYS) out['...'] = '+' + (keys.length - MAX_OBJ_KEYS) + ' more keys';
      }
      return out;
    } finally {
      seen.delete(v);
    }
  }

  // ---- DOM info -------------------------------------------------------------

  function domInfo(el) {
    if (!el) return null;
    if (el.nodeType === 3) {
      // Empty text nodes are fragment anchors — treat as "no root element".
      var tv = String(el.nodeValue || '').trim();
      return tv ? { tag: '#text', text: truncate(tv, TEXT_LIMIT) } : null;
    }
    if (el.nodeType === 8) return { tag: '#comment' };
    var node = { tag: String(el.tagName || '').toLowerCase() || String(el.nodeName || '') };
    if (el.id) node.id = String(el.id);
    var cls = String(el.className || ''); // String() guards SVGAnimatedString
    if (cls) node.class = truncate(cls, CLASS_LIMIT);
    if (el.childElementCount === 0) {
      var text = String(el.textContent || '').trim();
      if (text) node.text = truncate(text, TEXT_LIMIT);
    }
    return node;
  }

  // ---- Vue detection and root discovery --------------------------------------

  function detectVue() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].__vueParentComponent || all[i].__vue_app__) return;
    }
    for (i = 0; i < all.length; i++) {
      if (all[i].__vue__) {
        throw mkErr('vue2', 'Vue 2 detected — agent-vuetools does not support Vue 2 yet.');
      }
    }
    throw mkErr(
      'no-vue',
      'No Vue 3 app detected on this page (it may still be loading — retry in a moment).',
    );
  }

  function findRoots() {
    var roots = new Set();
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var inst = all[i].__vueParentComponent;
      if (!inst) continue;
      var guard = 0;
      while (inst.parent && guard++ < 1000) inst = inst.parent;
      roots.add(inst);
    }
    // Fallback: app instances not covered by the parent-walk (unlikely).
    for (i = 0; i < all.length; i++) {
      var app = all[i].__vue_app__;
      if (app && app._instance) roots.add(app._instance);
    }
    return Array.from(roots);
  }

  function versionOf(inst) {
    try {
      var app = inst && inst.appContext && inst.appContext.app;
      return (app && app.version) || null;
    } catch (e) {
      return null;
    }
  }

  // ---- component instance introspection --------------------------------------

  function typeName(t) {
    if (t === null || t === undefined) return 'any';
    if (t === String) return 'String';
    if (t === Number) return 'Number';
    if (t === Boolean) return 'Boolean';
    if (t === Array) return 'Array';
    if (t === Object) return 'Object';
    if (t === Function) return 'Function';
    if (t === Date) return 'Date';
    if (t === Symbol) return 'Symbol';
    if (t === BigInt) return 'BigInt';
    if (typeof t === 'function') return t.name || 'custom';
    return String(t);
  }

  function propDefs(propsDef) {
    var out = {};
    Object.keys(propsDef).forEach(function (k) {
      var p = propsDef[k] || {};
      var d = {};
      if (p.required !== undefined) d.required = !!p.required;
      if (p.type !== undefined) {
        d.type = Array.isArray(p.type) ? p.type.map(typeName) : [typeName(p.type)];
      }
      if (p.default !== undefined) {
        // Function defaults are factories unless the prop type is Function.
        var isFnType = p.type === Function || (Array.isArray(p.type) && p.type.indexOf(Function) !== -1);
        var value = typeof p.default === 'function' && !isFnType ? p.default() : p.default;
        d.default = serializeValue(value, new Set(), 3);
      }
      out[k] = d;
    });
    return out;
  }

  function computedInfo(inst, state) {
    var out = {};
    // Dev builds keep the raw setup result on devtoolsRawSetupState; there
    // ComputedRefs still carry their `.effect` marker (same check vue-devtools
    // uses). In prod builds script-setup computeds are not identifiable —
    // same limitation vue-devtools has — so they degrade to being omitted.
    var raw = inst.devtoolsRawSetupState;
    if (raw) {
      Object.keys(raw).forEach(function (k) {
        var v;
        try {
          v = raw[k];
        } catch (e) {
          return;
        }
        if (v && v.__v_isRef && v.effect) {
          try {
            out[k] = serializeValue(v.value, state.seen, MAX_VALUE_DEPTH);
          } catch (e) {
            out[k] = '[Error: ' + e.message + ']';
          }
        }
      });
    }
    // Options-API computeds: declared on type.computed, values on ctx.
    var decl = inst.type && inst.type.computed;
    if (decl) {
      var keys = Array.isArray(decl) ? decl : Object.keys(decl);
      keys.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(out, k)) return;
        try {
          out[k] = serializeValue(inst.ctx ? inst.ctx[k] : undefined, state.seen, MAX_VALUE_DEPTH);
        } catch (e) {
          out[k] = '[Error: ' + e.message + ']';
        }
      });
    }
    return out;
  }

  /** Read one component instance's state. `state.detail` adds prop definitions. */
  function componentInfo(inst, state) {
    var type = inst.type || {};
    var info = {
      name: componentName(type),
      file: type.__file || null,
    };
    var fields = state.fields; // null = all fields
    function want(f) {
      return fields === null || fields.indexOf(f) !== -1;
    }

    if (want('props')) {
      if (state.detail) {
        var props = {};
        if (type.props) props.defs = propDefs(type.props);
        props.values = serializeValue(inst.props, state.seen, MAX_VALUE_DEPTH);
        info.props = props;
      } else {
        info.props = serializeValue(inst.props, state.seen, MAX_VALUE_DEPTH);
      }
    }
    if (want('setupState')) {
      info.setupState = serializeValue(inst.setupState, state.seen, MAX_VALUE_DEPTH);
      // In <script setup>, props/attrs/slots/emit/expose are reserved binding
      // names — collapse them to markers instead of serializing the full
      // proxies. Detected via the compiler's __isScriptSetup flag.
      if (
        inst.setupState &&
        inst.setupState.__isScriptSetup === true &&
        info.setupState &&
        typeof info.setupState === 'object'
      ) {
        var reserved = { props: '[Props]', attrs: '[Attrs]', slots: '[Slots]', emit: '[Emit]', expose: '[Expose]' };
        Object.keys(reserved).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(info.setupState, k)) info.setupState[k] = reserved[k];
        });
      }
    }
    if (want('computed')) {
      var computed = computedInfo(inst, state);
      if (Object.keys(computed).length) info.computed = computed;
    }
    if (want('data') && inst.data) info.data = serializeValue(inst.data, state.seen, MAX_VALUE_DEPTH);
    if (want('exposed') && inst.exposed) {
      info.exposed = serializeValue(inst.exposed, state.seen, MAX_VALUE_DEPTH);
    }
    if (want('slots') && inst.slots) info.slots = Object.keys(inst.slots);
    if (want('attrs')) info.attrs = serializeValue(inst.attrs, state.seen, MAX_VALUE_DEPTH);
    if (want('emitted') && state.detail && type.emits) {
      // NOTE: instance.emitted only backs .once handler bookkeeping in Vue 3.5,
      // so fired events are not tracked here (see README roadmap).
      info.declaredEmits = Array.isArray(type.emits) ? type.emits : Object.keys(type.emits);
    }
    if (want('provides') && inst.provides) {
      info.provides = serializeValue(inst.provides, state.seen, 2);
    }
    return info;
  }

  // ---- tree walking ----------------------------------------------------------

  // Vue 3.5 renamed internal symbols to Symbol.for('v-*'); older versions use
  // Symbol('Fragment') etc. Normalize to canonical names.
  function symbolKind(desc) {
    switch (desc) {
      case 'Fragment':
      case 'v-fgt':
        return 'fragment';
      case 'Text':
      case 'v-txt':
        return 'text';
      case 'Comment':
      case 'v-cmt':
        return 'comment';
      case 'Static':
      case 'v-stc':
        return 'static';
      default:
        return desc;
    }
  }

  function walkChildren(vnode, depth, state) {
    var kids = vnode.children;
    if (Array.isArray(kids)) {
      var out = [];
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c == null) continue;
        if (typeof c === 'string') {
          out.push({ kind: 'text', text: truncate(c, TEXT_LIMIT) });
          continue;
        }
        var n = walkVNode(c, depth + 1, state);
        if (n) out.push(n);
        if (state.nodes >= MAX_NODES) {
          state.truncated = true;
          break;
        }
      }
      return out;
    }
    if (typeof kids === 'string') return [{ kind: 'text', text: truncate(kids, TEXT_LIMIT) }];
    if (kids && typeof kids === 'object' && kids.type !== undefined) {
      var n2 = walkVNode(kids, depth + 1, state);
      return n2 ? [n2] : [];
    }
    return [];
  }

  function walkVNode(vnode, depth, state) {
    if (!vnode) return null;
    if (state.nodes >= MAX_NODES || depth > state.maxDepth) {
      state.truncated = true;
      return null;
    }
    state.nodes++;

    var t = vnode.type;

    if (typeof t === 'symbol') {
      // Symbols are module-scoped in Vue; identify by description.
      var kind = symbolKind(t.description || 'Symbol');
      if (kind === 'text') return { kind: 'text', text: truncate(String(vnode.children), TEXT_LIMIT) };
      if (kind === 'comment') return { kind: 'comment', text: truncate(String(vnode.children), TEXT_LIMIT) };
      // Fragment / Static (v-once hoists) / unknown: walk children generically.
      var special = { kind: kind, name: kind };
      var kids = walkChildren(vnode, depth, state);
      if (kids.length) special.children = kids;
      return special;
    }

    if (typeof t === 'string') {
      var node = { kind: 'element', name: t, dom: domInfo(vnode.el) };
      if (vnode.props) {
        var p = serializeValue(vnode.props, state.seen, 2);
        if (Object.keys(p).length) node.props = p;
      }
      var kids2 = walkChildren(vnode, depth, state);
      if (kids2.length) node.children = kids2;
      return node;
    }

    if (typeof t === 'object' && t !== null) {
      var name = componentName(t);
      var inst = vnode.component;
      if (!inst) {
        // Async components without a resolved instance, and Teleport in
        // Vue >= 3.5 (rendered as a plain vnode, no instance): keep the node
        // and still walk its children.
        var nnode = { kind: 'component', name: name, noInstance: true };
        var k = walkChildren(vnode, depth, state);
        if (k.length) nnode.children = k;
        return nnode;
      }
      if (state.seenComponents.has(inst)) {
        state.truncated = true;
        return { kind: 'component', name: name, duplicate: true };
      }
      state.seenComponents.add(inst);
      var cnode = componentInfo(inst, state);
      cnode.kind = 'component';
      cnode.name = name;
      cnode.dom = domInfo(inst.vnode && inst.vnode.el);
      var kids3 = componentChildren(inst, depth, state);
      if (kids3.length) cnode.children = kids3;
      return cnode;
    }

    return null;
  }

  /**
   * A component's rendered children: its subTree vnode itself (single-root
   * element or component) or a fragment node with the root children
   * (multi-root components).
   */
  function componentChildren(inst, depth, state) {
    var sub = inst.subTree;
    if (!sub) return [];
    if (typeof sub.type === 'symbol' && symbolKind(sub.type.description) === 'fragment') {
      var kids = walkChildren(sub, depth, state);
      var frag = { kind: 'fragment', name: 'Fragment' };
      if (kids.length) frag.children = kids;
      return [frag];
    }
    var node = walkVNode(sub, depth + 1, state);
    return node ? [node] : [];
  }

  /** Root node of one app: the root component instance itself. */
  function buildRoot(inst, state) {
    state.seenComponents.add(inst);
    var node = componentInfo(inst, state);
    node.kind = 'component';
    node.dom = domInfo(inst.vnode && inst.vnode.el);
    // -1 so the root component's subTree lands at depth 0.
    var kids = componentChildren(inst, -1, state);
    if (kids.length) node.children = kids;
    return node;
  }

  // ---- DOM queries (XPath / CSS) ---------------------------------------------

  /** Wrap a string as an XPath literal (XPath 1.0 has no escape mechanism). */
  function xpathStr(s) {
    if (s.indexOf("'") === -1) return "'" + s + "'";
    if (s.indexOf('"') === -1) return '"' + s + '"';
    return "concat('" + s.split('"').join("','\"','") + "')";
  }

  /** XPath expressions start with / or ./, or use an axis (contains '::'). */
  function looksLikeXpath(q) {
    return /^\s*(?:\/\/?|\(\s*\/|\.\/)/.test(q) || /::/.test(q);
  }

  /** Evaluate an XPath expression, returning element matches. */
  function evalXpath(xpath, limit) {
    var result;
    try {
      result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) {
      throw mkErr('bad-query', 'Invalid XPath: ' + e.message);
    }
    var elements = [];
    var total = 0;
    var n = Math.min(result.snapshotLength, limit);
    for (var i = 0; i < n; i++) {
      var item = result.snapshotItem(i);
      if (item && item.nodeType === 1) elements.push(item);
      total++;
    }
    return { elements: elements, total: total, truncated: result.snapshotLength > n };
  }

  /** Evaluate a CSS selector, returning element matches. */
  function cssElements(q, limit) {
    var all;
    try {
      all = document.querySelectorAll(q);
    } catch (e) {
      throw mkErr('bad-query', 'Invalid CSS selector: ' + e.message);
    }
    var elements = Array.prototype.slice.call(all, 0, limit);
    return { elements: elements, total: all.length, truncated: all.length > elements.length };
  }

  /** Resolve elements to owning component instances (deduped, capped). */
  function instancesOf(elements, cap) {
    var instances = [];
    var seen = new Set();
    for (var i = 0; i < elements.length && instances.length < cap; i++) {
      var cur = elements[i];
      while (cur && !cur.__vueParentComponent) cur = cur.parentElement;
      if (cur && cur.__vueParentComponent && !seen.has(cur.__vueParentComponent)) {
        seen.add(cur.__vueParentComponent);
        instances.push(cur.__vueParentComponent);
      }
    }
    return instances;
  }

  function owningComponent(el) {
    var cur = el;
    while (cur && !cur.__vueParentComponent) cur = cur.parentElement;
    return (cur && cur.__vueParentComponent) || null;
  }

  /**
   * Find components owning elements whose OWN direct text matches the query —
   * implemented as an XPath text()[contains(., q)] query (native engine).
   */
  function findByText(query) {
    var q = String(query).trim();
    if (!q) return [];
    return evalXpath('//*[text()[contains(., ' + xpathStr(q) + ')]]', 50).elements;
  }

  /** Collect matches of a DOM query (XPath or CSS) with their components. */
  function queryMatches(query, limit) {
    var q = String(query || '').trim();
    if (!q) throw mkErr('bad-query', 'query requires a non-empty expression.');
    var res;
    if (looksLikeXpath(q)) {
      res = evalXpath(q, limit);
    } else {
      try {
        res = cssElements(q, limit);
      } catch (cssErr) {
        try {
          res = evalXpath(q, limit);
        } catch (e) {
          throw mkErr('bad-query', cssErr.message + ' (not valid XPath either: ' + e.message + ')');
        }
      }
    }
    return {
      query: q,
      total: res.total,
      truncated: res.truncated,
      matches: res.elements.map(function (el) {
        var comp = owningComponent(el);
        return {
          dom: domInfo(el),
          component: comp
            ? { name: componentName(comp.type || {}), file: (comp.type && comp.type.__file) || null }
            : null,
        };
      }),
    };
  }

  // ---- style ------------------------------------------------------------------

  /** Common layout/typography/color properties (computed style defaults). */
  var STYLE_KEYS = [
    'display', 'visibility', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
    'margin', 'padding', 'border', 'border-radius', 'overflow', 'overflow-x', 'overflow-y',
    'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'line-height',
    'text-align', 'white-space', 'flex', 'flex-direction', 'align-items', 'justify-content',
    'gap', 'grid-template-columns', 'cursor', 'opacity', 'transform', 'transition', 'box-shadow',
  ];

  function styleOf(el, all) {
    var cs = getComputedStyle(el);
    var keys = all ? Array.prototype.slice.call(cs) : STYLE_KEYS;
    var style = {};
    keys.forEach(function (k) {
      var v = cs.getPropertyValue(k);
      if (v) style[k] = v;
    });
    var text = String(el.textContent || '').trim();
    return {
      // Explicit, untruncated identity fields — the class attribute is the
      // primary hook for style debugging.
      tag: String(el.tagName || '').toLowerCase(),
      id: el.id || null,
      class: el.getAttribute('class') || null,
      text: text || null,
      dom: domInfo(el),
      inline: el.getAttribute('style') || null,
      style: style,
    };
  }

  function walkAllComponents(roots, cb, state) {
    var queue = [];
    var seen = new Set();
    roots.forEach(function (r) {
      if (r.subTree) queue.push(r.subTree);
    });
    while (queue.length && state.nodes < MAX_NODES) {
      var v = queue.shift();
      if (!v || typeof v !== 'object') continue;
      state.nodes++;
      if (v.component) {
        var inst = v.component;
        if (!seen.has(inst)) {
          seen.add(inst);
          cb(inst);
          if (inst.subTree) queue.push(inst.subTree);
        }
      } else if (Array.isArray(v.children)) {
        for (var i = 0; i < v.children.length; i++) queue.push(v.children[i]);
      }
    }
  }

  // ---- inspect ---------------------------------------------------------------

  function inspectMatches(roots, query, state) {
    var matches = [];
    walkAllComponents(roots, function (inst) {
      var type = inst.type || {};
      var name = componentName(type);
      var file = type.__file || '';
      if (name === query || file.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
        matches.push(inst);
      }
    }, state);

    if (!matches.length) {
      // DOM level: CSS selector → XPath → visible-text (via XPath internally).
      var elements = [];
      if (looksLikeXpath(query)) {
        try {
          elements = evalXpath(query, 5).elements;
        } catch (e) {
          throw mkErr('bad-query', e.message);
        }
      } else {
        var cssEl = null;
        try {
          cssEl = document.querySelector(query);
        } catch (e) {
          /* not a CSS selector */
        }
        if (cssEl) {
          elements = [cssEl];
        } else {
          try {
            elements = evalXpath(query, 5).elements;
          } catch (e) {
            /* not XPath either */
          }
        }
      }
      matches = matches.concat(instancesOf(elements, 5));
    }
    if (!matches.length) {
      matches = matches.concat(instancesOf(findByText(query), 5));
    }

    if (!matches.length) {
      throw mkErr('not-found', 'No component matches query "' + query + '".');
    }

    return {
      query: query,
      instances: matches.map(function (inst) {
        var info = componentInfo(inst, state);
        var chain = [];
        var p = inst.parent;
        var guard = 0;
        while (p && guard++ < 100) {
          var pt = p.type || {};
          chain.unshift({ name: componentName(pt), file: pt.__file || null });
          p = p.parent;
        }
        info.parentChain = chain;
        info.dom = domInfo(inst.vnode && inst.vnode.el);
        return info;
      }),
    };
  }

  // ---- entry -----------------------------------------------------------------

  return function probe(task) {
    try {
      var state = {
        nodes: 0,
        maxDepth: Math.max(
          task && task.depth !== undefined && task.depth !== null ? Number(task.depth) : 8,
          1,
        ),
        fields: task && Array.isArray(task.fields) ? task.fields : null,
        detail: !!(task && task.detail),
        seen: new Set(),
        seenComponents: new Set(),
        truncated: false,
      };
      // tree/inspect need a Vue app; query/style are pure DOM tools and work
      // on any page.
      var isVueTask = task && (task.command === 'tree' || task.command === 'inspect');
      var roots = [];
      if (isVueTask) {
        detectVue();
        roots = findRoots();
        if (!roots.length) throw mkErr('no-vue', 'No Vue 3 app detected on this page (it may still be loading — retry in a moment).');
      }

      var data;
      if (task && task.command === 'tree') {
        data = {
          version: versionOf(roots[0]),
          apps: roots.length,
          truncated: state.truncated,
          roots: roots.map(function (r) {
            return buildRoot(r, state);
          }),
        };
        data.truncated = data.truncated || state.truncated;
      } else if (task && task.command === 'inspect') {
        data = inspectMatches(roots, task.query, state);
      } else if (task && task.command === 'query') {
        data = queryMatches(task.query, task.limit ? Number(task.limit) : 50);
      } else if (task && task.command === 'style') {
        var el = null;
        if (looksLikeXpath(task.query)) {
          el = evalXpath(task.query, 1).elements[0] || null;
        } else {
          try {
            el = document.querySelector(task.query);
          } catch (e) {
            el = evalXpath(task.query, 1).elements[0] || null;
          }
        }
        if (!el) throw mkErr('not-found', 'No element matches "' + task.query + '".');
        data = styleOf(el, task.all === true);
      } else {
        throw mkErr('internal', 'Unknown task command: ' + (task && task.command));
      }
      return JSON.stringify({ ok: true, data: data });
    } catch (e) {
      var error = { code: (e && e.code) || 'internal', message: String((e && e.message) || e) };
      if (e && e.stack) error.stack = e.stack;
      return JSON.stringify({ ok: false, error: error });
    }
  };
})()
// No trailing semicolon: the CLI wraps this source in parentheses to call it,
// so a ';' here would be a SyntaxError inside the wrapped expression.

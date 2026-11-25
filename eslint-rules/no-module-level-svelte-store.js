import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects a Svelte store created at module scope in renderer code:
 *
 *   import { writable } from 'svelte/store';
 *   export const switchAllDialog = writable({ open: false });   // flagged
 *
 * A module-level `writable`, `readable` or `derived` is app-wide shared state, and
 * shared state belongs in a Redux slice (packages/cloudlands-fe/AGENTS.md: Svelte stores
 * are deprecated). cloudlands-fe#5058 added one for a dialog; no check caught it, and
 * moving it to Redux after the full verification had passed took another refactor and
 * another verification round.
 *
 * Flagged is a store created by code that runs when the module loads:
 *
 * - top-level statements, module-level object literals, immediately invoked functions
 *   (also through `.call` / `.apply`), and static class fields and blocks;
 * - the body of a function declared in the file and called by load-time code
 *   (`export const foo = createFoo()`, the classic Svelte custom store);
 * - the constructor and instance fields of a class in the file instantiated by load-time
 *   code, and its static methods called by it (`export const x = X.getInstance()` with
 *   `new X()` inside), followed transitively through calls in the same file;
 * - the top level of a component's `<script module>` block, shared by every instance.
 *
 * Allowed: a store created in a component's instance `<script>`, in a callback, in an
 * instance method, or in a function nothing in the file calls at load time. Calls are
 * found through named imports (also aliased) and namespace imports of 'svelte/store'.
 * A factory exported and called at load time from another file is not followed.
 *
 * Ratchet: the `baseline` option maps each file that already had module-level stores to
 * its count; the first `count` in source order are tolerated and every further one is
 * reported. Counts may only shrink (eslint-rules/no-module-level-svelte-store.test.js).
 */

const MESSAGE =
  'Do not create a Svelte store at module scope: it is app-wide shared state, and Svelte ' +
  'stores are deprecated for shared state (packages/cloudlands-fe/AGENTS.md). Put the ' +
  'state in a Redux slice under src/store/renderer/slices and read it with selectors; ' +
  'see src/store/renderer/docs/MIGRATION_GUIDE.md (cloudlands-fe#5058 had to move a ' +
  'dialog store to Redux after review). A store created inside a component, function ' +
  'or instance is fine.';

const RULE_NAME = 'no-module-level-svelte-store';
const STORE_SOURCE = 'svelte/store';
const STORE_FACTORIES = new Set(['writable', 'readable', 'derived']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const LOAD = 'load';

function isImmediatelyInvoked(fn) {
  const parent = fn.parent;
  if (parent?.type === 'CallExpression' && parent.callee === fn) return true;
  return (
    parent?.type === 'MemberExpression' &&
    parent.object === fn &&
    ['call', 'apply'].includes(memberName(parent)) &&
    parent.parent?.type === 'CallExpression' &&
    parent.parent.callee === parent
  );
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal') return node.property.value;
  return null;
}

function className(classNode) {
  if (classNode.id) return classNode.id.name;
  const parent = classNode.parent;
  return parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier'
    ? parent.id.name
    : null;
}

function isModuleScript(element) {
  return element.startTag.attributes.some(
    (attribute) =>
      attribute.type === 'SvelteAttribute' &&
      (attribute.key.name === 'module' ||
        (attribute.key.name === 'context' && attribute.value?.[0]?.value === 'module')),
  );
}

// The code unit `node` runs in: LOAD when the module loads, `fn:<name>` for a function
// declared in the file, `class:<name>` for a class's constructor and instance fields,
// `static:<class>.<method>` for a static method, or null when it runs only later (a
// callback, an instance method, a component instance script).
function unitOf(node) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === 'SvelteScriptElement') return isModuleScript(parent) ? LOAD : null;
    if (parent.type === 'PropertyDefinition' || parent.type === 'AccessorProperty') {
      if (parent.value !== child || parent.static) continue;
      const name = className(parent.parent.parent);
      return name ? `class:${name}` : null;
    }
    if (!FUNCTIONS.has(parent.type) || isImmediatelyInvoked(parent)) continue;
    if (parent.type === 'FunctionDeclaration') return parent.id ? `fn:${parent.id.name}` : null;
    const holder = parent.parent;
    if (holder?.type === 'VariableDeclarator' && holder.init === parent) {
      return holder.id.type === 'Identifier' ? `fn:${holder.id.name}` : null;
    }
    if (holder?.type === 'MethodDefinition' && holder.value === parent) {
      const name = className(holder.parent.parent);
      if (!name) return null;
      if (holder.kind === 'constructor') return `class:${name}`;
      const method = holder.static && !holder.computed ? holder.key.name : null;
      return method ? `static:${name}.${method}` : null;
    }
    return null;
  }
  return LOAD;
}

// The unit a call or `new` expression runs, when it names one declared in the file.
function calleeUnit(node, caller) {
  const callee = node.callee;
  const ownClass = caller?.startsWith('static:') ? caller.slice(7).split('.')[0] : null;
  if (node.type === 'NewExpression') {
    if (callee.type === 'Identifier') return `class:${callee.name}`;
    return callee.type === 'ThisExpression' && ownClass ? `class:${ownClass}` : null;
  }
  if (callee.type === 'Identifier') return `fn:${callee.name}`;
  const method = memberName(callee);
  if (!method) return null;
  if (callee.object.type === 'Identifier') return `static:${callee.object.name}.${method}`;
  return callee.object.type === 'ThisExpression' && ownClass
    ? `static:${ownClass}.${method}`
    : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow creating a Svelte store (writable, readable, derived) at module scope in renderer code; use a Redux slice for shared state.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative source file → number of module-level stores it may still create.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      moduleLevelStore: MESSAGE,
    },
  },

  create(context) {
    const { sourceCode } = context;
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    const suppressed = suppressedLines(sourceCode, RULE_NAME);
    const factories = new Set();
    const namespaces = new Set();
    const calls = new Map();
    const stores = [];

    const isFactory = (callee) => {
      if (callee.type === 'Identifier') return factories.has(callee.name);
      const name = memberName(callee);
      return (
        STORE_FACTORIES.has(name) &&
        callee.object.type === 'Identifier' &&
        namespaces.has(callee.object.name)
      );
    };

    const recordCall = (node) => {
      const caller = unitOf(node);
      if (caller === null) return;
      const target = calleeUnit(node, caller);
      if (!target) return;
      if (!calls.has(caller)) calls.set(caller, new Set());
      calls.get(caller).add(target);
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== STORE_SOURCE || node.importKind === 'type') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.add(specifier.local.name);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            STORE_FACTORIES.has(specifier.imported.name ?? specifier.imported.value)
          ) {
            factories.add(specifier.local.name);
          }
        }
      },
      NewExpression: recordCall,
      CallExpression(node) {
        if (isFactory(node.callee)) {
          const unit = unitOf(node);
          if (unit !== null) stores.push({ node, unit });
          return;
        }
        recordCall(node);
      },
      'Program:exit'() {
        const loaded = new Set([LOAD]);
        const pending = [LOAD];
        while (pending.length) {
          for (const target of calls.get(pending.pop()) ?? []) {
            if (loaded.has(target)) continue;
            loaded.add(target);
            pending.push(target);
          }
        }
        let seen = 0;
        for (const { node } of stores.filter(({ unit }) => loaded.has(unit))) {
          // A disabled site still gets its report, so ESLint counts the directive as used,
          // but it does not use up the baseline allowance.
          if (!suppressed(node.loc.start.line)) {
            seen += 1;
            if (seen <= allowed) continue;
          }
          context.report({ node, messageId: 'moduleLevelStore' });
        }
      },
    };
  },
};

import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects a Svelte store created at module scope in renderer code:
 *
 *   import { writable } from 'svelte/store';
 *   export const switchAllDialog = writable({ open: false });   // flagged
 *
 * A module-level `writable`, `readable`, `derived` or `toStore` is app-wide shared state, and
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
const STORE_FACTORIES = new Set(['writable', 'readable', 'derived', 'toStore']);
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

function isModuleScript(element) {
  return element.startTag.attributes.some(
    (attribute) =>
      attribute.type === 'SvelteAttribute' &&
      (attribute.key.name === 'module' ||
        (attribute.key.name === 'context' && attribute.value?.[0]?.value === 'module')),
  );
}

function classOf(member) {
  return member.parent.parent;
}

// The code unit `node` runs in, identified by its AST node: LOAD when the module loads, a
// function node for a declared or const-bound function or a static method, a class node
// for its constructor and instance fields, or null when it runs only later (a callback,
// an instance method, a component instance script).
function unitOf(node) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === 'SvelteScriptElement') return isModuleScript(parent) ? LOAD : null;
    if (parent.type === 'PropertyDefinition' || parent.type === 'AccessorProperty') {
      if (parent.value !== child || parent.static) continue;
      return classOf(parent);
    }
    if (!FUNCTIONS.has(parent.type) || isImmediatelyInvoked(parent)) continue;
    if (parent.type === 'FunctionDeclaration') return parent;
    const holder = parent.parent;
    if (holder?.type === 'VariableDeclarator' && holder.init === parent) return parent;
    if (holder?.type === 'MethodDefinition' && holder.value === parent) {
      if (holder.kind === 'constructor') return classOf(holder);
      return holder.static ? parent : null;
    }
    return null;
  }
  return LOAD;
}

function staticMethod(classNode, name) {
  const method = classNode.body.body.find(
    (member) =>
      member.type === 'MethodDefinition' &&
      member.static &&
      member.kind === 'method' &&
      !member.computed &&
      member.key.name === name,
  );
  return method?.value ?? null;
}

const CLASSES = new Set(['ClassDeclaration', 'ClassExpression']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow creating a Svelte store (writable, readable, derived, toStore) at module scope in renderer code; use a Redux slice for shared state.',
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
    const calls = new Map();
    const stores = [];

    // The variable `identifier` names, found lexically, or null for a global.
    const variableOf = (identifier) => {
      for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable;
      }
      return null;
    };

    // The 'svelte/store' import specifier `identifier` is bound to, if any. Bindings are
    // resolved through scope analysis, so an import placed after its calls still counts
    // and a local binding that shadows it does not.
    const storeImport = (identifier) => {
      const definition = variableOf(identifier)?.defs[0];
      if (definition?.type !== 'ImportBinding') return null;
      const declaration = definition.parent;
      if (declaration.source.value !== STORE_SOURCE || declaration.importKind === 'type') {
        return null;
      }
      return definition.node.importKind === 'type' ? null : definition.node;
    };

    const isFactory = (callee) => {
      if (callee.type === 'Identifier') {
        const specifier = storeImport(callee);
        return (
          specifier?.type === 'ImportSpecifier' &&
          STORE_FACTORIES.has(specifier.imported.name ?? specifier.imported.value)
        );
      }
      return (
        STORE_FACTORIES.has(memberName(callee)) &&
        callee.object.type === 'Identifier' &&
        storeImport(callee.object)?.type === 'ImportNamespaceSpecifier'
      );
    };

    // The function or class node `identifier` is bound to in this file.
    const declarationOf = (identifier) => {
      const definition = variableOf(identifier)?.defs[0];
      if (!definition) return null;
      if (definition.type === 'FunctionName' || definition.type === 'ClassName') {
        return definition.node;
      }
      const init = definition.type === 'Variable' ? definition.node.init : null;
      return init && (FUNCTIONS.has(init.type) || CLASSES.has(init.type)) ? init : null;
    };

    // The unit a call or `new` expression runs, when it is one declared in this file.
    const calleeUnit = (node, caller) => {
      const callee = node.callee;
      const isStaticMethod =
        caller !== LOAD && caller?.parent?.type === 'MethodDefinition' && caller.parent.static;
      const ownClass = isStaticMethod ? classOf(caller.parent) : null;
      const classFor = (object) => {
        if (object.type === 'ThisExpression') return ownClass;
        if (object.type !== 'Identifier') return null;
        const declaration = declarationOf(object);
        return declaration && CLASSES.has(declaration.type) ? declaration : null;
      };
      if (node.type === 'NewExpression') return classFor(callee);
      if (callee.type === 'Identifier') {
        const declaration = declarationOf(callee);
        return declaration && FUNCTIONS.has(declaration.type) ? declaration : null;
      }
      const method = memberName(callee);
      const target = method ? classFor(callee.object) : null;
      return target ? staticMethod(target, method) : null;
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

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
 * Module scope is any code that runs once when the module loads: top-level statements,
 * module-level object literals, immediately invoked functions, and static class fields
 * and blocks. A store created inside any other function, a method or an instance field
 * belongs to its caller or instance and is allowed, as are stores in a component's
 * `<script>` (the rule is scoped to script modules in eslint.config.js). Calls are found
 * through named imports (also aliased) and namespace imports of 'svelte/store'.
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

function isImmediatelyInvoked(fn) {
  return fn.parent?.type === 'CallExpression' && fn.parent.callee === fn;
}

// Whether `node` runs once when the module loads.
function atModuleScope(node) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (FUNCTIONS.has(parent.type) && !isImmediatelyInvoked(parent)) return false;
    if (
      (parent.type === 'PropertyDefinition' || parent.type === 'AccessorProperty') &&
      parent.value === child &&
      !parent.static
    ) {
      return false;
    }
  }
  return true;
}

function memberName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal') return node.property.value;
  return null;
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
    let seen = 0;

    const isFactory = (callee) => {
      if (callee.type === 'Identifier') return factories.has(callee.name);
      const name = memberName(callee);
      return (
        STORE_FACTORIES.has(name) &&
        callee.object.type === 'Identifier' &&
        namespaces.has(callee.object.name)
      );
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
      CallExpression(node) {
        if (!isFactory(node.callee) || !atModuleScope(node)) return;
        // A disabled site still gets its report, so ESLint counts the directive as used,
        // but it does not use up the baseline allowance.
        if (!suppressed(node.loc.start.line)) {
          seen += 1;
          if (seen <= allowed) return;
        }
        context.report({ node, messageId: 'moduleLevelStore' });
      },
    };
  },
};

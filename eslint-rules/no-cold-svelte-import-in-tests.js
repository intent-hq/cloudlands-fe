const MESSAGE =
  "Cold dynamic import of '{{specifier}}' inside a test body bills the component's whole module-graph " +
  'transform to the first test that runs it (intent-hq/intent#1464). Warm the specifier at module ' +
  "scope with warmImport(() => import('{{specifier}}')) from src/test/warm-import, or use a static " +
  'top-level import.';

// Callees whose callback runs before any test body: imports directly inside
// that callback warm the module cache instead of being billed to a test's
// timeout. `vi.doMock` is deliberately absent — it is not hoisted, so its
// factory runs wherever the call sits and only when the mocked module is next
// imported.
const WARMING_CALLEES = new Set(['beforeAll', 'warmImport', 'vi.mock', 'vi.hoisted']);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function staticSpecifier(source) {
  if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function svelteSpecifier(source) {
  const specifier = staticSpecifier(source);
  return specifier?.endsWith('.svelte') ? specifier : null;
}

function calleeName(node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier'
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

// 'warm' when the import runs before tests: at module scope, or directly in
// the callback of a warming callee. Any other enclosing function — including
// one merely defined inside a warming callback and invoked later — is 'cold'.
function classify(ancestors) {
  const fn = [...ancestors].reverse().find((ancestor) => FUNCTION_TYPES.has(ancestor.type));
  if (!fn) return 'warm';
  const parent = fn.parent;
  const isWarmingCallback =
    parent?.type === 'CallExpression' &&
    parent.arguments.includes(fn) &&
    WARMING_CALLEES.has(calleeName(parent));
  return isWarmingCallback ? 'warm' : 'cold';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow dynamic .svelte imports inside test bodies unless the specifier is warmed before tests run',
    },
    schema: [],
    messages: {
      coldSvelteImport: MESSAGE,
    },
  },

  create(context) {
    const warmed = new Set();
    const cold = [];

    return {
      ImportDeclaration(node) {
        const specifier = svelteSpecifier(node.source);
        if (specifier) warmed.add(specifier);
      },

      ImportExpression(node) {
        const specifier = svelteSpecifier(node.source);
        if (!specifier) return;
        if (classify(context.sourceCode.getAncestors(node)) === 'warm') {
          warmed.add(specifier);
        } else {
          cold.push({ node, specifier });
        }
      },

      'Program:exit'() {
        for (const { node, specifier } of cold) {
          if (warmed.has(specifier)) continue;
          context.report({ node, messageId: 'coldSvelteImport', data: { specifier } });
        }
      },
    };
  },
};

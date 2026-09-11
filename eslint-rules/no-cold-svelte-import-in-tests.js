const MESSAGE =
  "Cold dynamic import of '{{specifier}}' inside a test body bills the component's whole module-graph " +
  'transform to the first test that runs it (intent-hq/intent#1464). Warm the specifier at module ' +
  "scope with warmImport(() => import('{{specifier}}')) from src/test/warm-import, or use a static " +
  'top-level import.';

// Callees whose callback runs before any test body: imports inside them warm
// the module cache instead of being billed to a test's timeout.
const WARMING_CALLEES = new Set(['beforeAll', 'warmImport', 'vi.mock', 'vi.doMock', 'vi.hoisted']);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function svelteSpecifier(source) {
  if (source?.type !== 'Literal' || typeof source.value !== 'string') return null;
  return source.value.endsWith('.svelte') ? source.value : null;
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

// 'warm' when the import runs before tests (module scope or under a warming
// callee), 'cold' when it runs inside some other function body.
function classify(ancestors) {
  let insideFunction = false;
  for (const ancestor of ancestors) {
    if (FUNCTION_TYPES.has(ancestor.type)) insideFunction = true;
    if (ancestor.type === 'CallExpression' && WARMING_CALLEES.has(calleeName(ancestor))) {
      return 'warm';
    }
  }
  return insideFunction ? 'cold' : 'warm';
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

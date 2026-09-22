import { relativeFilename } from './design-system/common.js';

const MESSAGE =
  "Reading '{{path}}' from disk to assert on its source text pins the test to how the source is " +
  'spelled, not what it does: harmless refactors (renames, reordering, reformatting) break the test ' +
  'without changing the observable contract (intent-hq/cloudlands-fe#2760). Render the component or ' +
  'call the exported function and assert on its behavior instead.';

const READ_CALLEES = new Set([
  'readFileSync',
  'readFile',
  'fs.readFileSync',
  'fs.readFile',
  'fs.promises.readFile',
  'fsp.readFile',
  'promises.readFile',
]);

const PATH_BUILDERS = new Set(['resolve', 'join', 'path.resolve', 'path.join']);

const EXEMPT_SEGMENTS = new Set([
  'fixtures',
  '__fixtures__',
  'mocks',
  '__mocks__',
  'goldens',
  '__snapshots__',
]);

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

// Dotted name of an identifier / identifier-only member chain (`fs.promises.readFile`).
function dottedName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = dottedName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

function isImportMetaUrl(node) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'url' &&
    node.object.type === 'MetaProperty' &&
    node.object.meta.name === 'import' &&
    node.object.property.name === 'meta'
  );
}

// The trailing run of static string arguments, joined as path segments;
// null when the last argument is dynamic.
function staticTail(args) {
  const tail = [];
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const segment = staticString(args[i]);
    if (segment === null) break;
    tail.unshift(segment);
  }
  return tail.length > 0 ? tail.join('/') : null;
}

// The static tail of a path argument: a string literal, an expression-free
// template literal, the trailing static arguments of resolve()/join(), or the
// first argument of `new URL(<string>, import.meta.url)`. Anything else is
// dynamic.
function staticPath(node) {
  const direct = staticString(node);
  if (direct !== null) return direct;
  if (node?.type === 'CallExpression' && node.arguments.length > 0) {
    const name = dottedName(node.callee);
    if (name && PATH_BUILDERS.has(name)) return staticTail(node.arguments);
  }
  if (
    node?.type === 'NewExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'URL' &&
    isImportMetaUrl(node.arguments[1])
  ) {
    return staticString(node.arguments[0]);
  }
  return null;
}

function isSourcePath(filePath) {
  const isSource =
    filePath.endsWith('.svelte') || (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts'));
  if (!isSource) return false;
  return !filePath.split(/[\\/]/).some((segment) => EXEMPT_SEGMENTS.has(segment));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow tests that read a .svelte/.ts source file from disk to assert on its text',
    },
    schema: [
      {
        type: 'object',
        properties: {
          baseline: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      sourceLiteralRead: MESSAGE,
    },
  },

  create(context) {
    const baseline = new Set(context.options[0]?.baseline ?? []);
    if (baseline.has(relativeFilename(context))) return {};

    return {
      CallExpression(node) {
        const name = dottedName(node.callee);
        if (!name || !READ_CALLEES.has(name)) return;
        const filePath = staticPath(node.arguments[0]);
        if (filePath === null || !isSourcePath(filePath)) return;
        context.report({ node, messageId: 'sourceLiteralRead', data: { path: filePath } });
      },
    };
  },
};

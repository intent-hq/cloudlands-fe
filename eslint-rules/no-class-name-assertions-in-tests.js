import { relativeFilename } from './design-system/common.js';

const MESSAGE =
  'Asserting on CSS class names pins the test to how a style is spelled, not to what the user ' +
  'sees, so a harmless restyle fails it and a real regression with the same class passes. See ' +
  "'Do not write decorative appearance tests' in packages/cloudlands-fe/AGENTS.md " +
  '(#do-not-write-decorative-appearance-tests). Assert behaviour or accessibility state instead: ' +
  'the resulting content, an aria-* / hidden / disabled attribute, the role, focus, or a ' +
  'real-browser visibility check. If a class really is the contract (e.g. a theme class another ' +
  'module reads), disable this rule on that line with a reason.';

// Matchers that compare an element's class string / token list against a spelling.
const CLASS_MATCHERS = new Set(['toContain', 'toMatch', 'toBe', 'toEqual', 'toStrictEqual']);

// Calls whose single argument passes through to the asserted value (`String(el.className)`).
const PASSTHROUGH_CALLS = new Set(['String', 'Array.from']);

const CLASS_PROPERTIES = new Set(['className', 'classList']);

// Bounds identifier → initializer chains (`const cls = el.className`).
const MAX_RESOLVE_DEPTH = 8;

function dottedName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = dottedName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

function propertyName(member) {
  if (member?.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return String(member.property.value);
  return null;
}

function isStringLiteral(node, value) {
  return (
    (node?.type === 'Literal' && node.value === value) ||
    (node?.type === 'TemplateLiteral' &&
      node.expressions.length === 0 &&
      node.quasis[0].value.cooked === value)
  );
}

// The `const` / `let` initializer an identifier is pinned to, or null.
function resolveInit(node, context) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (!variable) continue;
    if (variable.defs.length !== 1) return null;
    const [def] = variable.defs;
    if (def.type !== 'Variable' || !['const', 'let'].includes(def.parent.kind)) return null;
    if (variable.references.some((ref) => ref.isWrite() && !ref.init)) return null;
    return def.node.id.type === 'Identifier' ? def.node.init : null;
  }
  return null;
}

/**
 * How `node` reads an element's classes: `'contains'` for `classList.contains(...)`,
 * `'classes'` for `.className` / `.classList` / `getAttribute('class')` (or a value
 * derived from them, e.g. `el.className.split(' ')`), or null.
 */
function classRead(node, context, depth = 0) {
  if (!node || depth > MAX_RESOLVE_DEPTH) return null;
  switch (node.type) {
    case 'ChainExpression':
      return classRead(node.expression, context, depth);
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return classRead(node.expression, context, depth);
    case 'Identifier':
      return classRead(resolveInit(node, context), context, depth + 1);
    case 'MemberExpression':
      if (CLASS_PROPERTIES.has(propertyName(node))) return 'classes';
      return classRead(node.object, context, depth);
    case 'CallExpression': {
      const { callee } = node;
      const name = dottedName(callee);
      if (name && PASSTHROUGH_CALLS.has(name) && node.arguments.length === 1) {
        return classRead(node.arguments[0], context, depth);
      }
      if (callee.type !== 'MemberExpression') return null;
      const method = propertyName(callee);
      if (method === 'getAttribute' && isStringLiteral(node.arguments[0], 'class')) {
        return 'classes';
      }
      const receiver = classRead(callee.object, context, depth);
      return method === 'contains' && receiver === 'classes' ? 'contains' : receiver;
    }
    default:
      return null;
  }
}

// The `expect(actual, message?)` call at the root of a matcher chain
// (`expect(x).not.toContain`, `expect(x, 'why').toBe`).
function expectCall(callee) {
  let node = callee.object;
  while (node.type === 'MemberExpression' && !node.computed) node = node.object;
  return node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'expect' &&
    node.arguments.length >= 1 &&
    node.arguments.length <= 2
    ? node
    : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow unit-test assertions on an element’s className / classList / class attribute',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative test file → number of class-name assertions it may still
          // contain. The first `count` offending assertions in source order are
          // tolerated; every further one is reported.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      classNameAssertion: MESSAGE,
    },
  },

  create(context) {
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    let seen = 0;

    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier'
        ) {
          return;
        }
        const matcher = callee.property.name;
        const expectation = expectCall(callee);
        if (!expectation) return;
        let offending = matcher === 'toHaveClass';
        if (!offending) {
          const read = classRead(expectation.arguments[0], context);
          offending = read === 'contains' || (read === 'classes' && CLASS_MATCHERS.has(matcher));
        }
        if (!offending) return;
        seen += 1;
        if (seen > allowed) context.report({ node: expectation, messageId: 'classNameAssertion' });
      },
    };
  },
};

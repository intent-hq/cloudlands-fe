import { relativeFilename } from './design-system/common.js';

const MESSAGE =
  'Asserting on CSS class names pins the test to how a style is spelled, not to what the user ' +
  'sees, so a harmless restyle fails it and a real regression with the same class passes. See ' +
  "'Do not write decorative appearance tests' in packages/cloudlands-fe/AGENTS.md " +
  '(#do-not-write-decorative-appearance-tests). Assert behaviour or accessibility state instead: ' +
  'the resulting content, an aria-* / hidden / disabled attribute, the role, focus, or a ' +
  'real-browser visibility check. If a class really is the contract (e.g. a theme class another ' +
  'module reads), disable this rule on that line with a reason.';

// Matchers that only check a value exists or has a type; every other matcher on a class
// read compares its spelling.
const PRESENCE_MATCHERS = new Set(['toBeDefined', 'toBeUndefined', 'toBeTypeOf', 'toBeInstanceOf']);

// Calls whose single argument passes through to the asserted value (`String(el.className)`).
const PASSTHROUGH_CALLS = new Set(['String', 'Array.from']);

const EXPECT_CALLEES = new Set(['expect', 'expect.soft']);

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

// The single `const` / `let` declarator an identifier is bound by, or null. A binding
// written anywhere besides its declaration no longer holds that initializer.
function resolveDeclarator(node, context) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (!variable) continue;
    if (variable.defs.length !== 1) return null;
    const [def] = variable.defs;
    if (def.type !== 'Variable' || !['const', 'let'].includes(def.parent.kind)) return null;
    if (variable.references.some((ref) => ref.isWrite() && !ref.init)) return null;
    return def.node;
  }
  return null;
}

// Whether `name` is destructured from a `className` / `classList` key in `pattern`.
function destructuresClassKey(pattern, name) {
  if (pattern?.type !== 'ObjectPattern') return false;
  return pattern.properties.some((property) => {
    if (property.type !== 'Property') return false;
    const value =
      property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
    const key = property.computed ? null : (property.key.name ?? property.key.value);
    return value.type === 'Identifier' && value.name === name && CLASS_PROPERTIES.has(key);
  });
}

/**
 * Whether `node` reads an element's classes: `.className`, `.classList`,
 * `getAttribute('class')`, or a value derived from them (`el.className.split(' ')`,
 * `el.classList.contains('x')`, `!…`, `… === 'a b'`, a `const` bound to one).
 */
function isClassRead(node, context, depth = 0) {
  if (!node || depth > MAX_RESOLVE_DEPTH) return false;
  const recurse = (child) => isClassRead(child, context, depth);
  switch (node.type) {
    case 'ChainExpression':
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return recurse(node.expression);
    case 'UnaryExpression':
    case 'AwaitExpression':
      return recurse(node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return recurse(node.left) || recurse(node.right);
    case 'ConditionalExpression':
      return recurse(node.test) || recurse(node.consequent) || recurse(node.alternate);
    case 'TemplateLiteral':
      return node.expressions.some(recurse);
    case 'Identifier': {
      const declarator = resolveDeclarator(node, context);
      if (!declarator) return false;
      if (declarator.id.type !== 'Identifier' && destructuresClassKey(declarator.id, node.name)) {
        return true;
      }
      return isClassRead(declarator.init, context, depth + 1);
    }
    case 'MemberExpression':
      return CLASS_PROPERTIES.has(propertyName(node)) || recurse(node.object);
    case 'CallExpression': {
      const { callee } = node;
      const name = dottedName(callee);
      if (name && PASSTHROUGH_CALLS.has(name) && node.arguments.length === 1) {
        return recurse(node.arguments[0]);
      }
      if (callee.type !== 'MemberExpression') return false;
      if (propertyName(callee) === 'getAttribute' && isStringLiteral(node.arguments[0], 'class')) {
        return true;
      }
      return recurse(callee.object);
    }
    default:
      return false;
  }
}

// Matchers that read the class attribute off the element itself.
function isElementClassMatcher(matcher, args) {
  if (matcher === 'toHaveClass') return true;
  if (matcher === 'toHaveAttribute') return isStringLiteral(args[0], 'class');
  if (matcher === 'toHaveProperty') {
    const [path] = args;
    const first = path?.type === 'ArrayExpression' ? path.elements[0] : path;
    return (
      first?.type === 'Literal' &&
      typeof first.value === 'string' &&
      CLASS_PROPERTIES.has(first.value.split('.')[0])
    );
  }
  return false;
}

// The `expect(actual, message?)` call at the root of a matcher chain
// (`expect(x).not.toContain`, `expect(x, 'why').toBe`, `expect.soft(x).toBe`).
function expectCall(callee) {
  let node = callee.object;
  while (node.type === 'MemberExpression' && !node.computed) node = node.object;
  return node.type === 'CallExpression' &&
    EXPECT_CALLEES.has(dottedName(node.callee)) &&
    node.arguments.length >= 1 &&
    node.arguments.length <= 2
    ? node
    : null;
}

const RULE_NAME = 'no-class-name-assertions-in-tests';
const DIRECTIVE =
  /^\s*eslint-(disable|enable|disable-line|disable-next-line)(?:\s+([^]*?))?(?:\s+--[^]*)?\s*$/;

function namesThisRule(list) {
  if (!list) return true;
  return list
    .split(',')
    .map((rule) => rule.trim())
    .some((rule) => rule === RULE_NAME || rule.endsWith(`/${RULE_NAME}`));
}

// Lines on which an `eslint-disable*` directive turns this rule off, so the baseline
// count matches what ESLint actually reports.
function suppressedLines(context) {
  const lines = new Set();
  const ranges = [];
  let openFrom = null;
  for (const comment of context.sourceCode.getAllComments()) {
    const match = DIRECTIVE.exec(comment.value);
    if (!match || !namesThisRule(match[2])) continue;
    const [, kind] = match;
    if (kind === 'disable-line') lines.add(comment.loc.start.line);
    else if (kind === 'disable-next-line') lines.add(comment.loc.end.line + 1);
    else if (kind === 'disable' && comment.type === 'Block' && openFrom === null) {
      openFrom = comment.loc.start.line;
    } else if (kind === 'enable' && openFrom !== null) {
      ranges.push([openFrom, comment.loc.start.line]);
      openFrom = null;
    }
  }
  if (openFrom !== null) ranges.push([openFrom, Infinity]);
  return (line) => lines.has(line) || ranges.some(([from, to]) => line >= from && line <= to);
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
    const suppressed = suppressedLines(context);
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
        const offending =
          isElementClassMatcher(matcher, node.arguments) ||
          (!PRESENCE_MATCHERS.has(matcher) && isClassRead(expectation.arguments[0], context));
        // A reasoned `eslint-disable` is the sanctioned escape hatch; it must not use up
        // a baselined file's allowance, which counts only unsuppressed assertions.
        if (!offending || suppressed(expectation.loc.start.line)) return;
        seen += 1;
        if (seen > allowed) context.report({ node: expectation, messageId: 'classNameAssertion' });
      },
    };
  },
};

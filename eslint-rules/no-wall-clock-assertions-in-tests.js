import { relativeFilename } from './design-system/common.js';

const MESSAGE =
  'Asserting an elapsed wall-clock difference against a millisecond budget fails under CI load: ' +
  'the shared runners starve a fork ~4×, and intent-hq/cloudlands-fe#2740 went red three times on ' +
  'guards that took a few seconds locally. Assert an operation-unit growth bound instead (see ' +
  'src/lib/notes/text-rebase.test.ts and intent-hq/cloudlands-fe#2828) or make the clock ' +
  'deterministic with vi.useFakeTimers(). A test that must budget wall time is verified with ' +
  "`pnpm test:loaded <file>` first; see the AGENTS.md 'test that budgets wall time' paragraph.";

const MATCHERS = new Set([
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
]);

const CLOCK_CALLEES = new Set([
  'performance.now',
  'Date.now',
  'globalThis.performance.now',
  'window.performance.now',
]);

const WRAPPERS = new Set(['Math.round', 'Math.floor', 'Math.ceil', 'Number']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '%']);

// Bounds identifier → initializer → identifier chains (`const a = b; const b = ...`).
const MAX_RESOLVE_DEPTH = 8;

// Dotted name of an identifier / identifier-only member chain (`window.performance.now`).
function dottedName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = dottedName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

// `new Date()` with no arguments reads the clock; `new Date(1000)` is a fixed timestamp.
function isNewDate(node) {
  return (
    node?.type === 'NewExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'Date' &&
    node.arguments.length === 0
  );
}

// `performance.now()`, `Date.now()`, `new Date().getTime()`, `+new Date()` and their
// `globalThis.` / `window.` spellings.
function isDirectClockRead(node) {
  if (!node) return false;
  if (node.type === 'CallExpression') {
    const name = dottedName(node.callee);
    if (name && CLOCK_CALLEES.has(name)) return true;
    return (
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'getTime' &&
      isNewDate(node.callee.object)
    );
  }
  return node.type === 'UnaryExpression' && node.operator === '+' && isNewDate(node.argument);
}

// A numeric literal, optionally negated or combined with other literals (`2 * 1000`).
function isLiteralNumber(node) {
  if (!node) return false;
  if (node.type === 'Literal') return typeof node.value === 'number';
  if (node.type === 'UnaryExpression')
    return node.operator === '-' && isLiteralNumber(node.argument);
  if (node.type === 'BinaryExpression' && ARITHMETIC.has(node.operator)) {
    return isLiteralNumber(node.left) && isLiteralNumber(node.right);
  }
  return false;
}

// The initializer of the single `const` / `let` declaration an identifier resolves to.
function resolveInit(node, context) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (!variable) continue;
    if (variable.defs.length !== 1) return null;
    const [def] = variable.defs;
    if (def.type !== 'Variable' || !['const', 'let'].includes(def.parent.kind)) return null;
    return def.node.id.type === 'Identifier' ? def.node.init : null;
  }
  return null;
}

function unwrap(node) {
  if (node?.type === 'CallExpression' && node.arguments.length === 1) {
    const name = dottedName(node.callee);
    if (name && WRAPPERS.has(name)) return unwrap(node.arguments[0]);
  }
  return node;
}

function isClockRead(node, context, depth = 0) {
  const target = unwrap(node);
  if (!target || depth > MAX_RESOLVE_DEPTH) return false;
  if (target.type === 'Identifier') {
    return isClockRead(resolveInit(target, context), context, depth + 1);
  }
  return isDirectClockRead(target);
}

// A `-` between two operands where at least one reads the clock, or an identifier /
// `Math.round(...)` / `Number(...)` wrapper that resolves to one.
function isClockDifference(node, context, depth = 0) {
  const target = unwrap(node);
  if (!target || depth > MAX_RESOLVE_DEPTH) return false;
  if (target.type === 'Identifier') {
    return isClockDifference(resolveInit(target, context), context, depth + 1);
  }
  return (
    target.type === 'BinaryExpression' &&
    target.operator === '-' &&
    (isClockRead(target.left, context) || isClockRead(target.right, context))
  );
}

// The `expect(...)` call at the root of a matcher chain (`expect(d).not.toBeLessThan`).
function expectCall(callee) {
  let node = callee.object;
  while (node.type === 'MemberExpression' && !node.computed) node = node.object;
  return node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'expect' &&
    node.arguments.length === 1
    ? node
    : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow tests that assert an elapsed wall-clock difference against a millisecond budget',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative test file → number of wall-clock assertions it may still
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
      wallClockBudget: MESSAGE,
    },
  },

  create(context) {
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    // Reports are buffered so a `vi.useFakeTimers(` call anywhere in the file (which
    // makes `Date.now()` deterministic) can discard them at `Program:exit`.
    const offenders = [];
    let fakeTimers = false;

    return {
      CallExpression(node) {
        const { callee } = node;
        if (dottedName(callee) === 'vi.useFakeTimers') {
          fakeTimers = true;
          return;
        }
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !MATCHERS.has(callee.property.name) ||
          !isLiteralNumber(node.arguments[0])
        ) {
          return;
        }
        const expectation = expectCall(callee);
        if (!expectation || !isClockDifference(expectation.arguments[0], context)) return;
        offenders.push(expectation);
      },
      'Program:exit'() {
        if (fakeTimers) return;
        for (const node of offenders.slice(allowed)) {
          context.report({ node, messageId: 'wallClockBudget' });
        }
      },
    };
  },
};

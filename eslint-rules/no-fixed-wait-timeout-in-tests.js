import { defaultAsyncUtilTimeoutMs } from '../scripts/vitest-timeouts.mjs';
import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects a fixed time limit on a unit-test wait:
 *
 *   await waitFor(() => expect(x).toBe(1), { timeout: 3000 });     // flagged
 *   await screen.findByText('Ready', undefined, { timeout: 5_000 }); // flagged
 *   const SETTLE_MS = 5_000;
 *   await vi.waitFor(check, { timeout: SETTLE_MS });                 // flagged
 *   await vi.waitUntil(check, 2_000);                                // flagged
 *
 * src/test-setup.ts gives Testing Library's waits (`waitFor`, `findBy*` / `findAllBy*`,
 * `waitForElementToBeRemoved`) and vitest's `vi.waitFor` / `vi.waitUntil` a default
 * limit of half the CI-scaled test budget (`defaultAsyncUtilTimeoutMs()` in
 * scripts/vitest-timeouts.mjs: 15 s locally, 30 s on CI). Tests used to pass fixed
 * 3-5 s limits to get past the old 1 s library default (which ejected cloudlands-fe#3915
 * from the merge queue); next to the new default such a limit is stricter on CI, so it is
 * the next wait a loaded runner fails. cloudlands-fe#3958 and #3964 removed 31 of them by
 * hand, and the scan still missed one stored in a named constant.
 *
 * A limit is fixed when it is a number literal, arithmetic or a conditional over number
 * literals, or a `const` (or never-reassigned `let`) in the same file bound to one,
 * including a property of a `const` object literal. A limit computed at run time (from
 * `defaultAsyncUtilTimeoutMs()`, a parameter, a budget helper) is not flagged.
 *
 * Not flagged: a wait the test expects to fail, which needs a short limit to fail fast:
 * `await expect(waitFor(..., { timeout: 50 })).rejects...`, `.catch(...)`,
 * `.then(onFulfilled, onRejected)`, the same through a `const` holding the promise, or an
 * `await` inside a `try` block with a `catch` clause.
 *
 * A fixed per-test limit (`it(name, fn, 15_000)` or `it(name, { timeout }, fn)`) at or
 * below the CI wait default is also flagged when the test body runs a wait on the
 * default limit: the test times out before the failing wait reports its own assertion
 * (the review of cloudlands-fe#3964 caught two such 30 s caps).
 *
 * Accepts the shared per-file count baseline; findings on a line whose
 * `eslint-disable-line` / `eslint-disable-next-line` directive names this rule do not
 * use up a file's allowance. intent/require-disable-reason requires that directive to
 * give a reason after `--`.
 */

const RULE_NAME = 'no-fixed-wait-timeout-in-tests';
const CI_WAIT_DEFAULT_MS = defaultAsyncUtilTimeoutMs({ CI: 'true' });
const LOCAL_WAIT_DEFAULT_MS = defaultAsyncUtilTimeoutMs({});

const MESSAGE =
  `Waits default to half the CI-scaled test budget (${LOCAL_WAIT_DEFAULT_MS / 1000} s locally, ` +
  `${CI_WAIT_DEFAULT_MS / 1000} s on CI; defaultAsyncUtilTimeoutMs() in ` +
  'scripts/vitest-timeouts.mjs, set by src/test-setup.ts), so a fixed limit here is ' +
  'stricter than the default on CI and the first wait a loaded runner fails ' +
  '(cloudlands-fe#3958, #3964). Remove the `timeout` so the wait uses the default. A wait ' +
  'the test expects to fail may keep a short limit when the rejection is asserted ' +
  '(`await expect(waitFor(..., { timeout: 50 })).rejects...`). A limit that must follow a ' +
  'budget computes it from scripts/vitest-timeouts.mjs. Otherwise disable this rule on ' +
  'this line and give the reason after `--`.';

const TEST_TIMEOUT_MESSAGE =
  'This fixed per-test limit is at or below the CI wait default ' +
  `(${CI_WAIT_DEFAULT_MS / 1000} s, defaultAsyncUtilTimeoutMs() in ` +
  'scripts/vitest-timeouts.mjs), and the test runs a wait on that default, so on CI the ' +
  'test times out before a failing wait reports its own assertion (review of ' +
  'cloudlands-fe#3964). Drop the limit so the test uses the CI-scaled test budget, or ' +
  'disable this rule on this line and give the reason after `--`.';

const TESTING_LIBRARY_WAITS = new Set(['waitFor', 'waitForElementToBeRemoved']);
const VI_WAITS = new Set(['waitFor', 'waitUntil']);
const FIND_QUERY = /^find(All)?By[A-Z]\w*$/;
const TEST_FUNCTIONS = new Set(['it', 'test']);
const TEST_MODIFIERS = new Set([
  'only',
  'skip',
  'todo',
  'fails',
  'concurrent',
  'sequential',
  'shuffle',
  'each',
  'for',
  'skipIf',
  'runIf',
]);

const TS_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

// Bounds `const A = B; const B = 3000` chains.
const MAX_RESOLVE_DEPTH = 8;

function unwrap(node) {
  let current = node;
  while (current && TS_WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

function propertyName(member) {
  if (member?.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return String(member.property.value);
  return null;
}

function keyName(property) {
  if (property.type !== 'Property') return null;
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

function resolveVariable(identifier, context) {
  for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return null;
}

// The initializer of a single `const` / never-reassigned `let` binding, or null.
function constantInit(identifier, context) {
  const variable = resolveVariable(identifier, context);
  if (!variable || variable.defs.length !== 1) return null;
  const [def] = variable.defs;
  if (def.type !== 'Variable' || def.node.id.type !== 'Identifier') return null;
  if (!['const', 'let'].includes(def.parent.kind)) return null;
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  return def.node.init ?? null;
}

/** The object literal `node` evaluates to (directly or through a constant), or null. */
function resolveObject(node, context, depth = 0) {
  const current = unwrap(node);
  if (!current || depth > MAX_RESOLVE_DEPTH) return null;
  if (current.type === 'ObjectExpression') return current;
  if (current.type === 'Identifier') {
    return resolveObject(constantInit(current, context), context, depth + 1);
  }
  return null;
}

/** The value node of `object.key`, following spreads of constant objects; last wins. */
function objectProperty(object, key, context, depth = 0) {
  if (!object || depth > MAX_RESOLVE_DEPTH) return null;
  let found = null;
  for (const property of object.properties) {
    if (property.type === 'SpreadElement') {
      const spread = objectProperty(
        resolveObject(property.argument, context),
        key,
        context,
        depth + 1,
      );
      if (spread) found = spread;
    } else if (keyName(property) === key) {
      found = property.value;
    }
  }
  return found;
}

/**
 * The number a fixed expression evaluates to, or undefined when it depends on anything
 * computed at run time.
 */
function fixedValue(node, context, depth = 0) {
  const current = unwrap(node);
  if (!current || depth > MAX_RESOLVE_DEPTH) return undefined;
  const recurse = (child) => fixedValue(child, context, depth);
  switch (current.type) {
    case 'Literal':
      return typeof current.value === 'number' ? current.value : undefined;
    case 'UnaryExpression': {
      const value = recurse(current.argument);
      if (value === undefined) return undefined;
      if (current.operator === '-') return -value;
      if (current.operator === '+') return value;
      return undefined;
    }
    case 'BinaryExpression': {
      const left = recurse(current.left);
      const right = recurse(current.right);
      if (left === undefined || right === undefined) return undefined;
      switch (current.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '**':
          return left ** right;
        default:
          return undefined;
      }
    }
    case 'ConditionalExpression': {
      // `isCi ? 10_000 : 5_000` is still a fixed limit; report the smaller one.
      const consequent = recurse(current.consequent);
      const alternate = recurse(current.alternate);
      if (consequent === undefined || alternate === undefined) return undefined;
      return Math.min(consequent, alternate);
    }
    case 'Identifier':
      return fixedValue(constantInit(current, context), context, depth + 1);
    case 'MemberExpression': {
      const key = propertyName(current);
      if (key === null) return undefined;
      const value = objectProperty(resolveObject(current.object, context), key, context);
      return value ? fixedValue(value, context, depth + 1) : undefined;
    }
    default:
      return undefined;
  }
}

function isTestingLibraryImport(identifier, context) {
  const variable = resolveVariable(identifier, context);
  const def = variable?.defs[0];
  if (def?.type !== 'ImportBinding') return false;
  const source = def.parent?.source?.value;
  return typeof source === 'string' && source.startsWith('@testing-library/');
}

/**
 * `{ options: Node[], numberOption }` for a wait call: the argument(s) that may carry its
 * limit, and whether a bare number argument is itself the limit (`vi.waitFor(cb, 500)`).
 */
function waitCall(node, context) {
  const callee = unwrap(node.callee);
  if (callee.type === 'Identifier') {
    if (TESTING_LIBRARY_WAITS.has(callee.name) && isTestingLibraryImport(callee, context)) {
      return { options: node.arguments.slice(1, 2), numberOption: false };
    }
    if (FIND_QUERY.test(callee.name)) {
      return { options: node.arguments.slice(1), numberOption: false };
    }
    return null;
  }
  if (callee.type !== 'MemberExpression') return null;
  const name = propertyName(callee);
  if (name === null) return null;
  const object = unwrap(callee.object);
  if (object.type === 'Identifier' && object.name === 'vi' && VI_WAITS.has(name)) {
    return { options: node.arguments.slice(1, 2), numberOption: true };
  }
  if (FIND_QUERY.test(name)) return { options: node.arguments.slice(1), numberOption: false };
  return null;
}

/** The node holding a wait call's fixed limit, or null; `chosen` is any explicit limit. */
function fixedLimit(call, context) {
  let chosen = false;
  for (const option of call.options) {
    if (option.type === 'SpreadElement') continue;
    if (call.numberOption && fixedValue(option, context) !== undefined) {
      return { node: option, chosen: true };
    }
    const object = resolveObject(option, context);
    const timeout = objectProperty(object, 'timeout', context);
    if (timeout) {
      chosen = true;
      if (fixedValue(timeout, context) !== undefined) return { node: timeout, chosen };
    } else if (call.numberOption && !object) {
      // `vi.waitFor(cb, budget)`: a number computed at run time, or options we cannot read.
      chosen = true;
    }
  }
  return { node: null, chosen };
}

// Climbs past wrappers that keep the same promise: `await`, `(x as Promise<T>)`, `void`.
function promiseParent(node) {
  let current = node;
  while (
    current.parent &&
    (TS_WRAPPERS.has(current.parent.type) || current.parent.type === 'AwaitExpression')
  ) {
    current = current.parent;
  }
  return current;
}

function isExpectCallee(callee) {
  const node = unwrap(callee);
  if (node.type === 'Identifier') return node.name === 'expect';
  return (
    node.type === 'MemberExpression' &&
    unwrap(node.object).type === 'Identifier' &&
    unwrap(node.object).name === 'expect' &&
    propertyName(node) === 'soft'
  );
}

// `expect(<node>)` whose matcher chain goes through `.rejects`.
function isAssertedRejection(node) {
  const call = node.parent;
  if (call?.type !== 'CallExpression' || call.arguments[0] !== node) return false;
  if (!isExpectCallee(call.callee)) return false;
  for (let current = call; current.parent; current = current.parent) {
    const parent = current.parent;
    if (parent.type !== 'MemberExpression' || parent.object !== current) return false;
    if (propertyName(parent) === 'rejects') return true;
  }
  return false;
}

// `<node>.catch(...)` or `<node>.then(onFulfilled, onRejected)`.
function isHandledRejection(node) {
  const member = node.parent;
  if (member?.type !== 'MemberExpression' || member.object !== node) return false;
  const call = member.parent;
  if (call?.type !== 'CallExpression' || call.callee !== member) return false;
  const name = propertyName(member);
  return name === 'catch' || (name === 'then' && call.arguments.length >= 2);
}

// `try { await <node> } catch { ... }`, without crossing a function boundary.
function isInsideTryWithCatch(node) {
  for (let current = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'FunctionDeclaration'
    ) {
      return false;
    }
    if (parent.type === 'TryStatement' && parent.block === current && parent.handler) return true;
  }
  return false;
}

function isExpectedFailurePosition(node) {
  return isAssertedRejection(node) || isHandledRejection(node) || isInsideTryWithCatch(node);
}

/** Whether the test expects this wait to fail, so a short limit makes it fail fast. */
function expectsFailure(call, context) {
  const outer = promiseParent(call);
  if (isExpectedFailurePosition(outer)) return true;
  // `await expect(() => waitFor(...)).rejects...`
  const parent = outer.parent;
  if (
    parent?.type === 'ArrowFunctionExpression' &&
    parent.body === outer &&
    isAssertedRejection(parent)
  ) {
    return true;
  }
  // `const pending = waitFor(...); ...; await expect(pending).rejects...`
  if (
    parent?.type === 'VariableDeclarator' &&
    parent.init === outer &&
    parent.id.type === 'Identifier'
  ) {
    const variable = context.sourceCode.getDeclaredVariables(parent)[0];
    return (
      variable?.references.some(
        (reference) =>
          !reference.init && isExpectedFailurePosition(promiseParent(reference.identifier)),
      ) ?? false
    );
  }
  return false;
}

/** `{ callback, timeout }` for an `it` / `test` call, or null. */
function testCall(node) {
  let callee = unwrap(node.callee);
  // `it.each(table)(name, fn, timeout)`
  if (callee.type === 'CallExpression') callee = unwrap(callee.callee);
  while (callee.type === 'MemberExpression' && TEST_MODIFIERS.has(propertyName(callee) ?? '')) {
    callee = unwrap(callee.object);
  }
  if (callee.type !== 'Identifier' || !TEST_FUNCTIONS.has(callee.name)) return null;
  const args = node.arguments;
  const callbackIndex = args.findIndex(
    (arg) => arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression',
  );
  if (callbackIndex < 1) return null;
  const callback = args[callbackIndex];
  // `it(name, { timeout }, fn)` or `it(name, fn, timeout | { timeout })`.
  const before = callbackIndex === 2 ? args[1] : null;
  const after = args[callbackIndex + 1] ?? null;
  return { callback, limits: [before, after].filter(Boolean) };
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow fixed time limits on unit-test waits; the default scales with the CI test budget',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative test file → number of fixed limits it may still contain.
          // The first `count` findings in source order are tolerated.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      fixedWaitTimeout: MESSAGE,
      testTimeoutCutsOffWait: TEST_TIMEOUT_MESSAGE,
    },
  },

  create(context) {
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    const suppressed = suppressedLines(context.sourceCode, RULE_NAME);
    // Wait calls on the default limit, for the per-test check at Program:exit.
    const defaultWaits = [];
    const tests = [];
    const findings = [];

    return {
      CallExpression(node) {
        const test = testCall(node);
        if (test) tests.push(test);
        const call = waitCall(node, context);
        if (!call) return;
        const limit = fixedLimit(call, context);
        if (expectsFailure(node, context)) return;
        if (limit.node) findings.push({ node: limit.node, messageId: 'fixedWaitTimeout' });
        else if (!limit.chosen) defaultWaits.push(node);
      },
      'Program:exit'() {
        for (const { callback, limits } of tests) {
          const [start, end] = callback.range;
          if (!defaultWaits.some(({ range }) => range[0] >= start && range[1] <= end)) continue;
          for (const limit of limits) {
            const timeout =
              resolveObject(limit, context) !== null
                ? objectProperty(resolveObject(limit, context), 'timeout', context)
                : limit;
            const value = timeout ? fixedValue(timeout, context) : undefined;
            if (value !== undefined && value <= CI_WAIT_DEFAULT_MS) {
              findings.push({ node: timeout, messageId: 'testTimeoutCutsOffWait' });
            }
          }
        }
        // A constant shared by several waits is one fixed limit, reported once where it is
        // written.
        const unique = [
          ...new Map(findings.map((f) => [`${f.messageId}:${f.node.range[0]}`, f])).values(),
        ];
        unique.sort((a, b) => a.node.range[0] - b.node.range[0]);
        let seen = 0;
        for (const finding of unique) {
          // A reasoned `eslint-disable-line` is the sanctioned escape hatch; it must not use
          // up a baselined file's allowance, which counts only unsuppressed findings.
          if (suppressed(finding.node.loc.start.line)) continue;
          seen += 1;
          if (seen > allowed) context.report(finding);
        }
      },
    };
  },
};

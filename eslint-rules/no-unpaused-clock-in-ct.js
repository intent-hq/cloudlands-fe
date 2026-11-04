/**
 * Rejects `page.clock.install()` in a Playwright component test that never pauses the
 * clock:
 *
 *   await page.clock.install();            // flagged: time keeps flowing
 *   await shell.click();
 *   await page.clock.runFor(16);
 *   expect(await width(shell)).toBeLessThan(full);
 *
 * `install()` fakes the timers but keeps them moving with real time, so every slow step
 * on a busy CI runner lets frame loops and timers run past the frame the test samples.
 * `dock-edge-shell.ct.spec.ts` failed 56 of 80 loaded runs that way and 0 of 200 once
 * paused (cloudlands-fe#4148), after ejecting unrelated PRs from the merge queue at least
 * five times. `installPausedClock(page, beforePause?)` and `pauseClock(page)`
 * (src/test/ct-clock.ts, re-exported from src/test/ct-test.ts) install and pause it.
 *
 * An install counts as paused when every test it runs in reaches a pause: a
 * `*.clock.pauseAt(...)`, `pauseClock(...)` or `installPausedClock(...)` call in the
 * test body, in a `beforeEach` / `beforeAll` of an enclosing suite (or the file), or in
 * a same-file function those call. Which tests an install runs in follows from where it
 * is written: a test body is that test; a hook is every test of its suite; a same-file
 * function is every test that calls it. A function this file never calls must pause the
 * clock itself. Pauses are matched anywhere in the test, not only after the install.
 *
 * A test that needs time to keep moving (it only skips past a delay and asserts settled
 * state) disables this rule on the install line with a reason; intent/require-disable-reason
 * checks the reason.
 */

const MESSAGE =
  '`page.clock.install()` keeps the fake clock moving with real time, so on a busy CI ' +
  'runner animations and timers run past the frames this test checks and it fails at ' +
  'random (cloudlands-fe#4148: 56 of 80 loaded runs failed until the clock was paused, ' +
  'after ejecting unrelated PRs from the merge queue). Use `await installPausedClock(page)` ' +
  "from 'src/test/ct-test' (pass `() => mount(...)` to let setup run before the pause), " +
  'or call `await pauseClock(page)` before stepping time with `page.clock.runFor`. If this ' +
  'test needs time to keep moving, disable this rule on this line with a reason.';

const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const SUITE_NAMES = new Set(['describe']);
const HOOK_NAMES = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll']);
const SETUP_HOOKS = new Set(['beforeEach', 'beforeAll']);
const PAUSE_HELPERS = new Set(['pauseClock', 'installPausedClock']);
const MAX_DEPTH = 8;

function isFunction(node) {
  return (
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'FunctionDeclaration'
  );
}

function propertyName(node) {
  if (node?.type !== 'MemberExpression' || node.computed) return null;
  return node.property.type === 'Identifier' ? node.property.name : null;
}

// Names along a callee chain, outermost first: `test.describe.serial` → ['test',
// 'describe', 'serial']; `test.each(t)` → ['test', 'each'].
function calleePath(callee) {
  const names = [];
  let node = callee;
  for (;;) {
    if (node.type === 'MemberExpression') {
      const name = propertyName(node);
      if (name === null) return null;
      names.unshift(name);
      node = node.object;
    } else if (node.type === 'CallExpression') {
      node = node.callee;
    } else break;
  }
  if (node.type !== 'Identifier') return null;
  names.unshift(node.name);
  return names;
}

// 'test' | 'suite' | 'hook:<name>' | null for a call such as `test(...)`,
// `test.describe.serial(...)` or `test.beforeEach(...)`.
function runnerKind(call) {
  const path = calleePath(call.callee);
  if (!path) return null;
  const [root, ...rest] = path;
  if (root !== 'test' && root !== 'it' && root !== 'describe' && !HOOK_NAMES.has(root)) {
    return null;
  }
  if (HOOK_NAMES.has(root) && rest.length === 0) return `hook:${root}`;
  if (root === 'describe') return 'suite';
  if (rest.length === 0) return 'test';
  if (SUITE_NAMES.has(rest[0])) return 'suite';
  if (HOOK_NAMES.has(rest[0]) && rest.length === 1) return `hook:${rest[0]}`;
  if (rest.every((name) => TEST_MODIFIERS.has(name))) return 'test';
  return null;
}

function callbackOf(call) {
  return call.arguments.find(isFunction) ?? null;
}

function isClockMember(node) {
  if (node?.type === 'Identifier') return node.name === 'clock';
  return propertyName(node) === 'clock';
}

function isClockInstall(node) {
  return propertyName(node.callee) === 'install' && isClockMember(node.callee.object);
}

function isPause(node) {
  const { callee } = node;
  if (callee.type === 'Identifier') return PAUSE_HELPERS.has(callee.name);
  return propertyName(callee) === 'pauseAt' && isClockMember(callee.object);
}

// A function runs where it is written only as a callback argument (`test.step`, a
// `for…of` body's `Promise.all(...map(fn))`) or an IIFE.
function runsInline(fn) {
  const { parent } = fn;
  return (
    parent?.type === 'CallExpression' && (parent.callee === fn || parent.arguments.includes(fn))
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow page.clock.install() in a component test that never pauses the clock',
    },
    schema: [],
    messages: { unpausedClock: MESSAGE },
  },

  create(context) {
    if (!context.filename.endsWith('.ct.spec.ts')) return {};
    const { sourceCode } = context;
    const installs = [];
    const tests = [];
    const hooks = [];

    function variableOf(fn) {
      if (fn.type === 'FunctionDeclaration' && fn.id) {
        return sourceCode.getDeclaredVariables(fn)[0] ?? null;
      }
      const { parent } = fn;
      if (parent?.type === 'VariableDeclarator' && parent.init === fn) {
        return sourceCode.getDeclaredVariables(parent)[0] ?? null;
      }
      return null;
    }

    // The single same-file function a called identifier resolves to.
    function resolveHelper(node) {
      if (node?.type !== 'Identifier') return null;
      for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        if (variable.defs.length !== 1) return null;
        const [def] = variable.defs;
        if (def.type === 'FunctionName') return def.node;
        if (def.type === 'Variable' && isFunction(def.node.init)) return def.node.init;
        return null;
      }
      return null;
    }

    // Whether `fn`'s body, or a same-file function it calls, pauses the clock.
    function reachesPause(fn, stack = []) {
      let found = false;
      const visit = (node) => {
        if (found || !node || typeof node.type !== 'string') return;
        if (isFunction(node) && !runsInline(node)) return;
        if (node.type === 'CallExpression') {
          if (isPause(node)) {
            found = true;
            return;
          }
          const helper = resolveHelper(node.callee);
          if (
            helper &&
            !stack.includes(helper) &&
            stack.length < MAX_DEPTH &&
            reachesPause(helper, [...stack, helper])
          ) {
            found = true;
            return;
          }
        }
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const child = node[key];
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };
      visit(fn.body);
      return found;
    }

    // The suite bodies (outermost first, starting with the Program) a node sits in.
    function suitesOf(node) {
      const suites = [];
      for (let current = node.parent; current; current = current.parent) {
        if (
          isFunction(current) &&
          current.parent?.type === 'CallExpression' &&
          runnerKind(current.parent) === 'suite'
        ) {
          suites.unshift(current);
        }
        if (current.type === 'Program') suites.unshift(current);
      }
      return suites;
    }

    function testIsPaused(testCall) {
      const body = callbackOf(testCall);
      if (body && reachesPause(body)) return true;
      const suites = new Set(suitesOf(testCall));
      return hooks.some(
        ({ call, name }) =>
          SETUP_HOOKS.has(name) && suites.has(suiteOfHook(call)) && hookPauses(call),
      );
    }

    function suiteOfHook(call) {
      const suites = suitesOf(call);
      return suites[suites.length - 1];
    }

    function hookPauses(call) {
      const fn = callbackOf(call) ?? resolveHelper(call.arguments[0]);
      return Boolean(fn && reachesPause(fn));
    }

    // Where the code at `node` runs: inside a test, a hook, a same-file function, or
    // somewhere this rule cannot follow.
    function runnerOf(node) {
      for (let current = node.parent; current; current = current.parent) {
        if (!isFunction(current)) continue;
        const call = current.parent;
        if (call?.type === 'CallExpression' && call.arguments.includes(current)) {
          const kind = runnerKind(call);
          if (kind === 'test') return { kind: 'test', call };
          if (kind?.startsWith('hook:')) return { kind: 'hook', call };
          if (kind === 'suite') return { kind: 'unknown' };
        }
        if (runsInline(current)) continue;
        return { kind: 'function', fn: current };
      }
      return { kind: 'unknown' };
    }

    // The tests an install at `node` runs in; null when some caller cannot be followed.
    function testsRunning(node, stack = []) {
      const runner = runnerOf(node);
      if (runner.kind === 'test') return [runner.call];
      if (runner.kind === 'hook') {
        const suite = suiteOfHook(runner.call);
        return tests.filter((testCall) => suitesOf(testCall).includes(suite));
      }
      if (runner.kind !== 'function') return null;
      if (stack.includes(runner.fn) || stack.length >= MAX_DEPTH) return null;
      const variable = variableOf(runner.fn);
      if (!variable) return null;
      const result = [];
      for (const reference of variable.references) {
        // `const setup = async () => {...}` records its own initialising write.
        if (reference.init) continue;
        const { identifier } = reference;
        const call = identifier.parent;
        if (call?.type !== 'CallExpression' || call.callee !== identifier) return null;
        const callers = testsRunning(call, [...stack, runner.fn]);
        if (callers === null) return null;
        result.push(...callers);
      }
      return result.length > 0 ? result : null;
    }

    function installIsPaused(install) {
      const running = testsRunning(install);
      if (running !== null) return running.every(testIsPaused);
      const runner = runnerOf(install);
      return runner.kind === 'function' && reachesPause(runner.fn);
    }

    return {
      CallExpression(node) {
        if (isClockInstall(node)) {
          installs.push(node);
          return;
        }
        const kind = runnerKind(node);
        // `test.skip(condition, reason)` takes a condition callback, not a test body.
        if (kind === 'test' && callbackOf(node) && !isFunction(node.arguments[0])) {
          tests.push(node);
        } else if (kind?.startsWith('hook:')) hooks.push({ call: node, name: kind.slice(5) });
      },
      'Program:exit'() {
        for (const install of installs) {
          if (!installIsPaused(install)) {
            context.report({ node: install, messageId: 'unpausedClock' });
          }
        }
      },
    };
  },
};

const MESSAGE =
  '`{{call}}` drops the clock this test pinned with vi.setSystemTime, so the assertions after ' +
  'it read the real time of day and pass or fail depending on when CI runs. ' +
  'vi.clearAllTimers() rewinds the fake clock to the moment vi.useFakeTimers() installed it ' +
  '(the real time unless that install was itself pinned), vi.useRealTimers() restores the ' +
  "real clock, and vi.useFakeTimers({ toFake }) without 'Date' stops faking Date. " +
  'intent-hq/cloudlands-fe#3574 passed its PR checks in the morning and failed 20/20 in the ' +
  'merge queue after 08:00 UTC (merge_group run 39583441525). Pin the clock again with ' +
  'vi.setSystemTime(...) right after this call, before asserting.';

const TEST_CALLEES = new Set(['it', 'test']);
const SUITE_CALLEES = new Set(['describe', 'suite']);
const SETUP_HOOKS = ['beforeAll', 'beforeEach'];
// Callbacks registered here run after the test body, not where they appear in it, as a
// bare call or on the test context (`ctx.onTestFinished(...)`).
const DEFERRED_CALLEES = new Set(['afterEach', 'afterAll', 'onTestFinished', 'onTestFailed']);

// Bounds helper → helper expansion (`setup()` calling `pinClock()` calling ...).
const MAX_HELPER_DEPTH = 6;

function isFunction(node) {
  return (
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'FunctionDeclaration'
  );
}

function propertyName(node) {
  if (node.type !== 'MemberExpression' || node.computed) return null;
  return node.property.type === 'Identifier' ? node.property.name : null;
}

// The identifier a call chain is rooted at: `it` for `it.only(...)`, `it.each(t)(...)`
// and `test.concurrent.skip(...)`, `vi` for `vi.useFakeTimers().setSystemTime(...)`.
function rootName(callee) {
  let node = callee;
  for (;;) {
    if (node.type === 'MemberExpression') node = node.object;
    else if (node.type === 'CallExpression') node = node.callee;
    else break;
  }
  return node.type === 'Identifier' ? node.name : null;
}

// `vi.<method>(...)` or a chained `vi.<a>(...).<method>(...)`.
function viMethod(node) {
  const name = propertyName(node.callee);
  if (!name) return null;
  const { object } = node.callee;
  if (object.type === 'Identifier' && object.name === 'vi') return name;
  if (object.type === 'CallExpression' && rootName(object.callee) === 'vi') return name;
  return null;
}

function objectProperty(node, key) {
  if (node?.type !== 'ObjectExpression') return undefined;
  return node.properties.find(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === key) ||
        (property.key.type === 'Literal' && property.key.value === key)),
  );
}

// `vi.useFakeTimers(config)`: whether it installs at an explicit `now`, and whether it
// fakes Date (`false` only for a literal `toFake` list without 'Date').
function useFakeTimersEvent(config) {
  const toFake = objectProperty(config, 'toFake')?.value;
  const fakesDate =
    toFake?.type !== 'ArrayExpression' ||
    toFake.elements.some((element) => element?.type === 'Literal' && element.value === 'Date');
  return { kind: 'fake', now: Boolean(objectProperty(config, 'now')), fakesDate };
}

function clockEvent(node) {
  switch (viMethod(node)) {
    case 'setSystemTime':
      return { kind: 'pin' };
    case 'useRealTimers':
      return { kind: 'real' };
    case 'clearAllTimers':
      return { kind: 'clear' };
    case 'useFakeTimers':
      return useFakeTimersEvent(node.arguments[0]);
    default:
      return null;
  }
}

function isExpectCall(node) {
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'expect';
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'expect' &&
    ['soft', 'poll'].includes(propertyName(callee))
  );
}

function isDeferredCall(node) {
  const { callee } = node;
  const name = callee.type === 'Identifier' ? callee.name : propertyName(callee);
  return Boolean(name && DEFERRED_CALLEES.has(name));
}

// A function runs where it is written only as a callback argument or an IIFE; a
// declaration or a `const f = () => ...` runs where it is called (see resolveHelper).
function runsInline(fn) {
  const { parent } = fn;
  return (
    parent?.type === 'CallExpression' && (parent.callee === fn || parent.arguments.includes(fn))
  );
}

function callText(node, sourceCode) {
  const text = sourceCode.getText(node).replace(/\s+/g, ' ');
  return text.length <= 72 ? text : `${sourceCode.getText(node.callee)}(…)`;
}

/**
 * Clock state while replaying a test's setup hooks and body in execution order.
 * `faking` is 'unknown' until a call in the replay installs or removes fake timers;
 * `installPinned` records whether the current fake-timer install started at a pinned
 * time, which is where `vi.clearAllTimers()` rewinds the clock to.
 */
function initialState() {
  return { pinned: false, faking: 'unknown', installPinned: false, dropped: null };
}

function apply(state, event, offenders) {
  const drop = () => {
    if (state.pinned) state.dropped = { node: event.node, reported: false };
    state.pinned = false;
  };
  switch (event.kind) {
    case 'pin':
      state.pinned = true;
      state.dropped = null;
      break;
    case 'real':
      drop();
      state.faking = 'no';
      state.installPinned = false;
      break;
    case 'fake':
      if (!event.fakesDate) {
        drop();
        state.installPinned = false;
      } else if (event.now) {
        state.pinned = true;
        state.installPinned = true;
        state.dropped = null;
      } else {
        // Reinstalling reads the current (fake or date-only) time, so a pin survives.
        state.installPinned = state.pinned;
      }
      state.faking = 'yes';
      break;
    case 'clear':
      // A no-op without fake timers; a rewind to a pinned install stays deterministic.
      if (state.faking !== 'no' && !state.installPinned) drop();
      break;
    case 'expect':
      if (offenders && state.dropped && !state.dropped.reported) {
        state.dropped.reported = true;
        offenders.push(state.dropped.node);
      }
      break;
    default:
      break;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow assertions after a test drops the fake clock it pinned with vi.setSystemTime',
    },
    schema: [],
    messages: {
      fakeClockReset: MESSAGE,
    },
  },

  create(context) {
    const { sourceCode } = context;
    const tests = [];

    // The single function declaration / `const f = () => {}` a called identifier
    // resolves to in this file.
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

    // Clock and assertion events of `fn`'s body in execution order: a call's callee and
    // arguments run before it, and a same-file helper call expands to the helper's own
    // events, reported at the outermost call (`at`).
    function collectEvents(fn, { at = null, stack = [] } = {}) {
      const events = [];
      const visit = (node) => {
        if (!node || typeof node.type !== 'string') return;
        if (isFunction(node) && !runsInline(node)) return;
        if (node.type === 'CallExpression' && isDeferredCall(node)) return;
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const child = node[key];
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
        if (node.type !== 'CallExpression') return;
        if (isExpectCall(node)) {
          events.push({ kind: 'expect', node: at ?? node });
          return;
        }
        const event = clockEvent(node);
        if (event) {
          events.push({ ...event, node: at ?? node });
          return;
        }
        const helper = resolveHelper(node.callee);
        if (helper && !stack.includes(helper) && stack.length < MAX_HELPER_DEPTH) {
          events.push(...collectEvents(helper, { at: at ?? node, stack: [...stack, helper] }));
        }
      };
      visit(fn.body);
      return events;
    }

    // `beforeAll` / `beforeEach` callbacks registered directly in a suite body, inline
    // or by a same-file function name.
    function setupHooks(suite, hook) {
      const statements = suite.type === 'Program' ? suite.body : (suite.body?.body ?? []);
      return statements.flatMap((statement) => {
        const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
        if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier') return [];
        if (call.callee.name !== hook) return [];
        const [first] = call.arguments;
        const fn = isFunction(first) ? first : resolveHelper(first);
        return fn ? [fn] : [];
      });
    }

    // The clock state a test body starts in: every `beforeAll` (outermost suite first),
    // then every `beforeEach`.
    function stateAfterHooks(testCall) {
      const suites = [];
      for (let node = testCall.parent; node; node = node.parent) {
        if (
          isFunction(node) &&
          node.parent?.type === 'CallExpression' &&
          SUITE_CALLEES.has(rootName(node.parent.callee))
        ) {
          suites.unshift(node);
        }
        if (node.type === 'Program') suites.unshift(node);
      }
      const state = initialState();
      for (const hook of SETUP_HOOKS) {
        for (const suite of suites) {
          for (const fn of setupHooks(suite, hook)) {
            for (const event of collectEvents(fn)) apply(state, event, null);
          }
        }
      }
      state.dropped = null;
      return state;
    }

    return {
      CallExpression(node) {
        if (!TEST_CALLEES.has(rootName(node.callee))) return;
        const body = node.arguments.find(isFunction);
        if (body) tests.push({ node, body });
      },
      'Program:exit'() {
        const offenders = [];
        for (const { node, body } of tests) {
          const state = stateAfterHooks(node);
          for (const event of collectEvents(body)) apply(state, event, offenders);
        }
        for (const node of offenders) {
          context.report({
            node,
            messageId: 'fakeClockReset',
            data: { call: callText(node, sourceCode) },
          });
        }
      },
    };
  },
};

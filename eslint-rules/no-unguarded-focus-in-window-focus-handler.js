/**
 * Rejects a `focus()` call in a window focus handler that does not first check the
 * window still has focus:
 *
 *   window.on('focus', () => {
 *     view.webContents.focus();               // flagged
 *   });
 *
 *   window.on('focus', () => {
 *     if (!window.isFocused()) return;
 *     view.webContents.focus();               // allowed
 *   });
 *
 * On macOS and Linux, Electron's WebContents::Focus() also calls
 * owner_window()->Focus(true), so it raises its window. A 'focus' event can arrive after
 * the user moved to another window; focusing then raises the old window, which focuses
 * the other one again, and two windows trade focus without end. Linux/X11 hung the main
 * process (the frame-window E2E, after cloudlands-fe#4546 added the handler); macOS
 * swapped windows on screen (intent-hq/intent#9928, fixed by cloudlands-fe#4958).
 *
 * Checked handlers: `<emitter>.on|once|addListener|prependListener|prependOnceListener`
 * with event 'focus' (guard on `<emitter>.isFocused()`), or app 'browser-window-focus'
 * (guard on the window parameter; a handler without a plain window parameter cannot be
 * guarded, so every focus() in it is flagged). The handler is an inline function or a
 * function declared in the same file. Every `<x>.focus()` call in it is flagged, whatever `x` is: in
 * the main process each focus() (WebContents, BrowserWindow, app) can raise a window.
 * A call is allowed after an early `if (!<window>.isFocused()) return;` (also in an `||`
 * chain, or as `isFocused() === false`), or inside `if (<window>.isFocused()) { ... }`.
 * The check must be in the function that calls focus(), with no await or yield between
 * them: a timer, promise or other callback runs later, so it needs its own check (even a
 * synchronous one such as forEach, which the rule cannot tell apart).
 * Helpers called from the handler, and handlers passed as `this.<name>`, are not followed.
 */

const MESSAGE =
  "focus() in a window 'focus' handler raises that window again on macOS and Linux " +
  "(Electron's WebContents::Focus() calls owner_window()->Focus(true)). If the event is " +
  'stale and the user has moved to another window, two windows trade focus without end: ' +
  'the main process hung on Linux/X11 (cloudlands-fe#4546) and windows swapped places on ' +
  'macOS (intent-hq/intent#9928, cloudlands-fe#4958). Start the handler with ' +
  '`if (!{{window}}.isFocused()) return;`. In a timer or other callback, or after an ' +
  'await, repeat the check just before focus().';

const LISTENER_METHODS = new Set([
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
]);

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

function unwrap(node) {
  let current = node;
  while (
    current?.type === 'ChainExpression' ||
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSNonNullExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function memberName(node) {
  const target = unwrap(node);
  if (target?.type !== 'MemberExpression') return null;
  if (!target.computed && target.property.type === 'Identifier') return target.property.name;
  return staticString(target.property);
}

// An inline handler, or a function bound to the handler's name in this file.
function resolveHandler(node, sourceCode) {
  const target = unwrap(node);
  if (FUNCTION_TYPES.has(target?.type)) return target;
  if (target?.type !== 'Identifier') return null;
  let scope = sourceCode.getScope(target);
  while (scope) {
    const variable = scope.set.get(target.name);
    if (variable) {
      for (const def of variable.defs) {
        if (def.type === 'FunctionName') return def.node;
        if (def.type === 'Variable' && FUNCTION_TYPES.has(unwrap(def.node.init)?.type)) {
          return unwrap(def.node.init);
        }
      }
      return null;
    }
    scope = scope.upper;
  }
  return null;
}

// `<window>.isFocused()`
function isFocusedCall(node, windowText, sourceCode) {
  if (windowText === null) return false;
  const call = unwrap(node);
  if (call?.type !== 'CallExpression' || memberName(call.callee) !== 'isFocused') return false;
  return sourceCode.getText(unwrap(unwrap(call.callee).object)) === windowText;
}

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.range[1] >= b.range[1] ? a : b;
}

// The `<window>.isFocused()` call that makes the test true whenever the window has lost
// focus, or null.
function notFocusedCheck(node, windowText, sourceCode) {
  const test = unwrap(node);
  if (test?.type === 'UnaryExpression' && test.operator === '!') {
    return isFocusedCall(test.argument, windowText, sourceCode) ? test.argument : null;
  }
  if (test?.type === 'BinaryExpression' && ['===', '=='].includes(test.operator)) {
    const [call, other] = isFocusedCall(test.left, windowText, sourceCode)
      ? [test.left, test.right]
      : [test.right, test.left];
    const matches =
      isFocusedCall(call, windowText, sourceCode) &&
      other.type === 'Literal' &&
      other.value === false;
    return matches ? call : null;
  }
  if (test?.type === 'LogicalExpression' && test.operator === '||') {
    return later(
      notFocusedCheck(test.left, windowText, sourceCode),
      notFocusedCheck(test.right, windowText, sourceCode),
    );
  }
  return null;
}

// The `<window>.isFocused()` call that makes the test false whenever the window has lost
// focus, or null.
function focusedCheck(node, windowText, sourceCode) {
  const test = unwrap(node);
  if (isFocusedCall(test, windowText, sourceCode)) return test;
  if (test?.type === 'LogicalExpression' && test.operator === '&&') {
    return later(
      focusedCheck(test.left, windowText, sourceCode),
      focusedCheck(test.right, windowText, sourceCode),
    );
  }
  return null;
}

function alwaysReturns(statement) {
  if (statement?.type === 'ReturnStatement') return true;
  return statement?.type === 'BlockStatement' && alwaysReturns(statement.body.at(-1));
}

// The isFocused() call of an early-return guard statement, or null.
function guardCheck(statement, windowText, sourceCode) {
  if (statement.type !== 'IfStatement' || !alwaysReturns(statement.consequent)) return null;
  return notFocusedCheck(statement.test, windowText, sourceCode);
}

function enclosingFunction(node) {
  let current = node.parent;
  while (current && !FUNCTION_TYPES.has(current.type)) current = current.parent;
  return current;
}

// An await or yield in `fn` itself, between `start` and the end of `call`, that runs
// before focus(): focus can move to another window while it waits. An await of the
// focus() call itself runs after it.
function suspendsBefore(fn, start, call, visitorKeys) {
  const visit = (node) => {
    if (node !== fn && FUNCTION_TYPES.has(node.type)) return false;
    if (
      (node.type === 'AwaitExpression' || node.type === 'YieldExpression') &&
      node.range[0] >= start &&
      node.range[1] <= call.range[1] &&
      (node.range[1] <= call.range[0] || node.range[0] >= call.range[0])
    ) {
      return true;
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string' && visit(child)) return true;
      }
    }
    return false;
  };
  return visit(fn);
}

// The check must run in the function that calls focus(), with no await between: a guard
// in the handler does not cover a timer, promise or other callback that runs later.
function isGuarded(call, windowText, sourceCode) {
  if (windowText === null) return false;
  const fn = enclosingFunction(call);
  // From the isFocused() call to the end of the focus() call, receiver and arguments
  // included: an await anywhere in that span makes the check stale.
  const fresh = (check) => !suspendsBefore(fn, check.range[1], call, sourceCode.visitorKeys);
  if (fn.body.type === 'BlockStatement') {
    let check = null;
    for (const statement of fn.body.body) {
      if (statement.range[1] > call.range[0]) break;
      check = guardCheck(statement, windowText, sourceCode) ?? check;
    }
    if (check && fresh(check)) return true;
  }
  let child = call;
  for (let node = call.parent; node && node !== fn; node = node.parent) {
    if (node.type === 'IfStatement' && node.consequent === child) {
      const check = focusedCheck(node.test, windowText, sourceCode);
      if (check && fresh(check)) return true;
    }
    child = node;
  }
  return false;
}

function collectFocusCalls(root, visitorKeys) {
  const calls = [];
  const visit = (node) => {
    if (node.type === 'CallExpression' && memberName(node.callee) === 'focus') calls.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') visit(child);
      }
    }
  };
  visit(root);
  return calls;
}

// The window whose focus the handler must check, as source text (`guard`; null when the
// handler has no name for it, so no guard can match), or null for other listeners.
function focusedWindow(call, handler, sourceCode) {
  const event = staticString(call.arguments[0]);
  const emitter = unwrap(unwrap(call.callee).object);
  if (event === 'focus') {
    const text = sourceCode.getText(emitter);
    return { guard: text, label: text };
  }
  if (
    event === 'browser-window-focus' &&
    emitter?.type === 'Identifier' &&
    emitter.name === 'app'
  ) {
    const param = handler.params[1];
    if (param?.type === 'Identifier') return { guard: param.name, label: param.name };
    return { guard: null, label: 'window' };
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require a window 'focus' handler to return when the window is no longer focused before it calls focus(), so two windows cannot trade focus without end.",
    },
    schema: [],
    messages: {
      unguardedFocus: MESSAGE,
    },
  },
  create(context) {
    const { sourceCode } = context;
    const checked = new Set();
    return {
      CallExpression(node) {
        if (!LISTENER_METHODS.has(memberName(node.callee))) return;
        const handler = resolveHandler(node.arguments[1], sourceCode);
        if (!handler) return;
        const target = focusedWindow(node, handler, sourceCode);
        if (!target) return;
        const windowText = target.guard;
        const key = `${handler.range[0]}:${windowText}`;
        if (checked.has(key)) return;
        checked.add(key);
        for (const call of collectFocusCalls(handler.body, sourceCode.visitorKeys)) {
          if (isGuarded(call, windowText, sourceCode)) continue;
          context.report({
            node: call,
            messageId: 'unguardedFocus',
            data: { window: target.label },
          });
        }
      },
    };
  },
};

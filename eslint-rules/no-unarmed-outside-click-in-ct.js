/**
 * Rejects an outside click that dismisses a bits-ui layer in a Playwright component
 * test unless the test first waits for the layer to listen for outside pointers:
 *
 *   await trigger.click();
 *   await expect(menu).toBeVisible();
 *   await page.mouse.click(850, 300);        // flagged
 *   await expect(menu).toHaveCount(0);
 *
 * bits-ui's DismissibleLayerState registers its document `pointerdown` listeners in
 * `afterSleep(1, …)`, a timer that runs after the layer mounts, so the click that opened
 * the layer is not treated as an outside click. Chromium runs queued input ahead of
 * timers, so on a busy machine the outside click can arrive first; bits-ui never sees it
 * and the layer stays open. One such test failed 3 of 20 runs (cloudlands-fe#3696), which
 * is enough to eject unrelated PRs from the merge queue. `expectDismissibleLayerArmed`
 * (src/test/dismissible-layer.ts) waits until the layer is registered.
 *
 * Flagged: `<x>.mouse.click(...)`, `<x>.mouse.dblclick(...)`, `<x>.touchscreen.tap(...)`,
 * or `.click()` / `.dblclick()` / `.tap()` on a locator whose expression mentions
 * "outside", "overlay" or "backdrop" (`outside.click()`,
 * `page.locator('[data-slot="dialog-overlay"]').click(...)`), when a closed-state
 * assertion follows it before any other interaction (`toHaveCount(0)`, `toBeHidden()`,
 * `not.toBeVisible()`, `toBeVisible({ visible: false })`, `not.toBeAttached()`,
 * `toHaveAttribute('aria-expanded', 'false')` or `toHaveAttribute('data-state', 'closed')`)
 * and no `await expectDismissibleLayerArmed(...)` statement precedes it without another
 * interaction in between. Any interaction (`click`, `press`, `hover`, `focus`, `fill`,
 * `keyboard.*`, `mouse.*`, `component.update`, an awaited helper such as `reopenTop()`,
 * or one inside a `test.step` callback) can open a new layer, so it cancels an earlier
 * wait; awaited `expect…` assertion helpers do not. The wait must be a statement of its
 * own: one inside an `if` branch does not count. Scans pass through `if`/`else` and `try`
 * blocks, but never out of a loop body, since a loop can reopen the layer before the
 * next iteration's click.
 *
 * Not flagged: clicks without a following closed-state assertion, Escape (its keydown
 * listener is registered synchronously), and files other than `*.ct.spec.ts`. A click
 * that closes a layer from inside it, such as choosing a menu item by coordinates, or a
 * click on a popup that is not a bits-ui layer, is not an outside dismissal; disable the
 * rule on that line with a reason.
 */

const MESSAGE =
  'This click dismisses a bits-ui layer from outside before the layer is known to listen ' +
  'for outside pointers. bits-ui registers those listeners in afterSleep(1) after the layer ' +
  'mounts; on a busy machine the click can arrive first, bits-ui ignores it, and the layer ' +
  'stays open (cloudlands-fe#3696: 3 of 20 runs failed). Call ' +
  "`await expectDismissibleLayerArmed(layer)` from 'src/test/dismissible-layer' right " +
  'before the click, with no other interaction in between, for each open layer the click ' +
  'must close. If the click lands inside the layer (for example a menu item by ' +
  'coordinates), it is not an outside dismissal: disable this rule on that line with a reason.';

const GUARD = 'expectDismissibleLayerArmed';

const INTERACTION_METHODS = new Set([
  'check',
  'click',
  'dblclick',
  'dispatchEvent',
  'dragTo',
  'fill',
  'focus',
  'hover',
  'mount',
  'press',
  'pressSequentially',
  'selectOption',
  'setChecked',
  'setInputFiles',
  'tap',
  'type',
  'uncheck',
  'update',
]);

const DEVICE_OBJECTS = new Set(['keyboard', 'mouse', 'touchscreen']);

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

function unwrap(node) {
  let current = node;
  while (current?.type === 'AwaitExpression' || current?.type === 'ChainExpression') {
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  }
  return current;
}

// The identifier a call chain is rooted at: `expect` for `expect(x).not.toBeVisible()`
// and `expect.poll(fn).toBe(true)`.
function rootName(node) {
  let current = node;
  for (;;) {
    if (current?.type === 'MemberExpression') current = current.object;
    else if (current?.type === 'CallExpression') current = current.callee;
    else break;
  }
  return current?.type === 'Identifier' ? current.name : null;
}

function isDeviceCall(callee) {
  return DEVICE_OBJECTS.has(propertyName(callee.object));
}

// Calls in `node` in source order. With `intoFunctions`, also inside callbacks such as
// `test.step('reopen', async () => ...)`, whose interactions run as test steps.
function collectCalls(node, intoFunctions, calls = []) {
  if (!node || typeof node.type !== 'string') return calls;
  if (!intoFunctions && isFunction(node)) return calls;
  if (node.type === 'CallExpression') calls.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) collectCalls(child, intoFunctions, calls);
    } else if (value && typeof value.type === 'string') {
      collectCalls(value, intoFunctions, calls);
    }
  }
  return calls;
}

function isGuardCall(call) {
  return call.callee.type === 'Identifier' && call.callee.name === GUARD;
}

// Only `await expectDismissibleLayerArmed(...)` as a statement of its own counts: a wait
// inside one branch of an `if`, or followed by an interaction in the same block, may not
// cover the click.
function isGuardStatement(statement) {
  if (statement?.type !== 'ExpressionStatement') return false;
  const expression = unwrap(statement.expression);
  return expression?.type === 'CallExpression' && isGuardCall(expression);
}

function isInteractionCall(call) {
  const { callee } = call;
  if (callee.type === 'Identifier') {
    // An awaited helper (`await reopenTop()`) may open a layer. Assertion helpers named
    // `expect…` (`expectAnimationsToSettle`, `expectHitTarget`) and the wait do not.
    return !/^expect/.test(callee.name) && call.parent?.type === 'AwaitExpression';
  }
  const name = propertyName(callee);
  if (!name) return false;
  if (isDeviceCall(callee)) return true;
  return INTERACTION_METHODS.has(name) && rootName(callee) !== 'expect';
}

function containsInteraction(statement) {
  return collectCalls(statement, true).some(isInteractionCall);
}

function isStatementList(node) {
  return node?.type === 'BlockStatement' || node?.type === 'Program' || node?.type === 'SwitchCase';
}

function statementsOf(list) {
  return list.type === 'SwitchCase' ? list.consequent : list.body;
}

function isLoop(node) {
  return (
    node?.type === 'ForStatement' ||
    node?.type === 'ForOfStatement' ||
    node?.type === 'ForInStatement' ||
    node?.type === 'WhileStatement' ||
    node?.type === 'DoWhileStatement'
  );
}

// The statement that holds `node` directly inside a statement list, or null when `node`
// sits in a nested function expression body first. With `stopAtLoops`, a loop body also
// yields null: a loop runs its body again after later interactions, so the backward
// search for a wait may not leave it.
function enclosingListedStatement(node, stopAtLoops = false) {
  let current = node;
  while (current.parent) {
    if (isStatementList(current.parent)) return current;
    if (isFunction(current.parent) || (stopAtLoops && isLoop(current.parent))) return null;
    current = current.parent;
  }
  return null;
}

// A block a scan may leave to continue in the enclosing statement list: an `if`/`else`
// branch, a bare block, or a `try` block. Never a loop body, `catch`, or function body.
function isTransparentBlock(list) {
  if (list.type !== 'BlockStatement') return false;
  const { parent } = list;
  return (
    parent?.type === 'IfStatement' ||
    parent?.type === 'BlockStatement' ||
    (parent?.type === 'TryStatement' && parent.block === list)
  );
}

function isGuarded(click) {
  let statement = enclosingListedStatement(click, true);
  while (statement) {
    const list = statement.parent;
    const siblings = statementsOf(list);
    for (let index = siblings.indexOf(statement) - 1; index >= 0; index--) {
      if (isGuardStatement(siblings[index])) return true;
      if (containsInteraction(siblings[index])) return false;
    }
    if (!isTransparentBlock(list)) return false;
    statement = enclosingListedStatement(list, true);
  }
  return false;
}

function literalValue(node) {
  return node?.type === 'Literal' ? node.value : undefined;
}

// `{ <key>: false }` as the matcher's options.
function optionIsFalse(options, key) {
  if (options?.type !== 'ObjectExpression') return false;
  return options.properties.some(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === key) ||
        literalValue(property.key) === key) &&
      literalValue(property.value) === false,
  );
}

function isClosedAssertion(call) {
  const name = propertyName(call.callee);
  if (!name || rootName(call.callee) !== 'expect') return false;
  const negated = propertyName(call.callee.object) === 'not';
  const [first, second] = call.arguments;
  switch (name) {
    case 'toHaveCount':
      return !negated && literalValue(first) === 0;
    case 'toBeHidden':
      return !negated;
    case 'toBeVisible':
      return negated !== optionIsFalse(first, 'visible');
    case 'toBeAttached':
      return negated !== optionIsFalse(first, 'attached');
    case 'toHaveAttribute':
      return (
        !negated &&
        ((literalValue(first) === 'aria-expanded' && literalValue(second) === 'false') ||
          (literalValue(first) === 'data-state' && literalValue(second) === 'closed'))
      );
    default:
      return false;
  }
}

// Whether a closed-state assertion follows the click before any other interaction. The
// scan continues past the end of an `if`/`else` or `try` block that holds the click.
function assertsDismissal(click) {
  let statement = enclosingListedStatement(click);
  while (statement) {
    const list = statement.parent;
    const siblings = statementsOf(list);
    for (let index = siblings.indexOf(statement) + 1; index < siblings.length; index++) {
      if (containsInteraction(siblings[index])) return false;
      if (collectCalls(siblings[index], true).some(isClosedAssertion)) return true;
    }
    if (!isTransparentBlock(list)) return false;
    statement = enclosingListedStatement(list);
  }
  return false;
}

const CLICK_METHODS = new Set(['click', 'dblclick', 'tap']);

function isOutsideClick(node, sourceCode) {
  const { callee } = node;
  const name = propertyName(callee);
  if (!CLICK_METHODS.has(name)) return false;
  const device = propertyName(callee.object);
  if (device === 'mouse') return name !== 'tap';
  if (device === 'touchscreen') return name === 'tap';
  if (device === 'keyboard') return false;
  return /outside|overlay|backdrop/i.test(sourceCode.getText(callee.object));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require expectDismissibleLayerArmed before an outside click dismisses a bits-ui layer in a component test.',
    },
    schema: [],
    messages: {
      unarmedOutsideClick: MESSAGE,
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!filename.endsWith('.ct.spec.ts')) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        if (!isOutsideClick(node, sourceCode)) return;
        if (!assertsDismissal(node)) return;
        if (isGuarded(node)) return;
        context.report({ node, messageId: 'unarmedOutsideClick' });
      },
    };
  },
};

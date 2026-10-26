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
 * Flagged: `<x>.mouse.click(...)`, or `<locator>.click(...)` whose locator expression
 * mentions "outside" (`outside.click()`, `getByTestId('outside-target').click()`), when
 * the `expect(...)` statements directly after it assert that something closed
 * (`toHaveCount(0)`, `toBeHidden()`, `not.toBeVisible()`, or
 * `toHaveAttribute('aria-expanded', 'false')`) and no `expectDismissibleLayerArmed(...)`
 * call precedes it without another interaction in between. Any interaction (`click`,
 * `press`, `hover`, `focus`, `fill`, `keyboard.*`, `mouse.*`, `component.update`, or an
 * awaited same-file helper such as `openMenu()`) can open a new layer, so it cancels an
 * earlier wait. An `if`/`else` one-liner counts as the statement it sits in; a click at
 * the start of a nested block keeps scanning the statements before that block.
 *
 * Not flagged: clicks followed by any other assertion, Escape (its keydown listener is
 * registered synchronously), and files other than `*.ct.spec.ts`. A click that closes a
 * layer from inside it, such as choosing a menu item by coordinates, is not an outside
 * dismissal; disable the rule on that line with a reason.
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

// Calls in `node`, without descending into nested functions (callbacks such as
// `expect.poll(() => ...)` or `evaluate(() => ...)` do not run as test steps here).
function collectCalls(node, calls = []) {
  if (!node || typeof node.type !== 'string') return calls;
  if (isFunction(node)) return calls;
  if (node.type === 'CallExpression') calls.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) collectCalls(child, calls);
    } else if (value && typeof value.type === 'string') {
      collectCalls(value, calls);
    }
  }
  return calls;
}

function isGuardCall(call) {
  return call.callee.type === 'Identifier' && call.callee.name === GUARD;
}

function isInteractionCall(call) {
  const { callee } = call;
  if (callee.type === 'Identifier') {
    // An awaited same-file helper (`await reopenTop()`) may open a layer; `expect(...)`
    // and the guard itself do not.
    return (
      callee.name !== GUARD && callee.name !== 'expect' && call.parent?.type === 'AwaitExpression'
    );
  }
  const name = propertyName(callee);
  if (!name) return false;
  if (isDeviceCall(callee)) return true;
  return INTERACTION_METHODS.has(name) && rootName(callee) !== 'expect';
}

function statementGuardState(statement) {
  const calls = collectCalls(statement);
  if (calls.some(isGuardCall)) return 'guarded';
  if (calls.some(isInteractionCall)) return 'interaction';
  return 'neutral';
}

function isStatementList(node) {
  return node?.type === 'BlockStatement' || node?.type === 'Program' || node?.type === 'SwitchCase';
}

function statementsOf(list) {
  return list.type === 'SwitchCase' ? list.consequent : list.body;
}

// The statement that holds `node` directly inside a statement list, or null when `node`
// sits in a nested function expression body first.
function enclosingListedStatement(node) {
  let current = node;
  while (current.parent) {
    if (isStatementList(current.parent)) return current;
    if (isFunction(current.parent)) return null;
    current = current.parent;
  }
  return null;
}

function isGuarded(click) {
  let statement = enclosingListedStatement(click);
  while (statement) {
    const list = statement.parent;
    const siblings = statementsOf(list);
    for (let index = siblings.indexOf(statement) - 1; index >= 0; index--) {
      const state = statementGuardState(siblings[index]);
      if (state === 'guarded') return true;
      if (state === 'interaction') return false;
    }
    // Reached the start of the block: continue before the block's own statement
    // (an `if` body, a loop body), but never out of the enclosing function.
    if (list.type === 'Program' || isFunction(list.parent)) return false;
    statement = enclosingListedStatement(list);
  }
  return false;
}

function literalValue(node) {
  return node?.type === 'Literal' ? node.value : undefined;
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
      return negated;
    case 'toHaveAttribute':
      return (
        !negated && literalValue(first) === 'aria-expanded' && literalValue(second) === 'false'
      );
    default:
      return false;
  }
}

// `await expect(...)...;` or an `if` whose branches hold only such statements.
function assertionCalls(statement) {
  if (!statement) return null;
  if (statement.type === 'ExpressionStatement') {
    const expression = unwrap(statement.expression);
    if (expression?.type !== 'CallExpression' || rootName(expression.callee) !== 'expect') {
      return null;
    }
    return [expression];
  }
  if (statement.type === 'BlockStatement') {
    const calls = [];
    for (const child of statement.body) {
      const nested = assertionCalls(child);
      if (!nested) return null;
      calls.push(...nested);
    }
    return calls;
  }
  if (statement.type === 'IfStatement') {
    const consequent = assertionCalls(statement.consequent);
    if (!consequent) return null;
    if (!statement.alternate) return consequent;
    const alternate = assertionCalls(statement.alternate);
    return alternate ? [...consequent, ...alternate] : null;
  }
  return null;
}

function assertsDismissal(click) {
  let statement = enclosingListedStatement(click);
  while (statement) {
    const list = statement.parent;
    const siblings = statementsOf(list);
    for (let index = siblings.indexOf(statement) + 1; index < siblings.length; index++) {
      const calls = assertionCalls(siblings[index]);
      if (!calls) return false;
      if (calls.some(isClosedAssertion)) return true;
    }
    // Reached the end of an `if`/`else` block: the assertions after the `if` follow
    // this click too. A loop body or function ends the scan.
    if (list.type !== 'BlockStatement' || list.parent?.type !== 'IfStatement') return false;
    statement = enclosingListedStatement(list);
  }
  return false;
}

function isOutsideClick(node, sourceCode) {
  const { callee } = node;
  if (propertyName(callee) !== 'click') return false;
  if (propertyName(callee.object) === 'mouse') return true;
  return /outside/i.test(sourceCode.getText(callee.object));
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

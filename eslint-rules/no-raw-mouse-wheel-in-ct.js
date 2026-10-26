/**
 * Rejects a raw mouse wheel in a Playwright component test:
 *
 *   await list.hover();
 *   await page.mouse.wheel(0, 600);           // flagged
 *   await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
 *
 * Chromium routes a wheel by the compositor's last committed frame. On a busy machine
 * that frame can predate the element under the pointer, so the wheel is dropped even
 * though the element is scrollable and under the pointer; a second wheel at the same
 * point scrolls at once. A single wheel therefore fails at random: cloudlands-fe#3733
 * (TaskProgressControl, 4 of 320 runs at 32 workers) and cloudlands-fe#3516
 * (home-pr-panel, intent-hq/intent#7255). `wheelUntilScrolled` (src/test/ct-wheel.ts,
 * re-exported from src/test/ct-test.ts) resends the wheel until the container scrolls.
 *
 * Flagged: any `<x>.mouse.wheel(...)` call in a `*.ct.spec.ts` file, whatever the
 * receiver (`page.mouse`, `this.page.mouse`, `host.page().mouse`, a destructured
 * `mouse`), including computed keys (`mouse['wheel']`, ``mouse[`wheel`]``), the
 * `.call` / `.apply` / `.bind` forms, and names bound earlier in the file to a mouse or
 * its wheel (`const m = page.mouse`, `const { wheel } = page.mouse`). Aliases are tracked
 * by name per file, without scope analysis. The helper module is
 * not a spec file, so it may send the wheel itself. A test that must show a wheel does
 * NOT scroll keeps the raw call and disables this rule on that line with a reason.
 */

const MESSAGE =
  'A single mouse wheel can be dropped by Chromium on a busy machine: it routes the wheel ' +
  "by the compositor's last committed frame, which can predate the element under the " +
  'pointer, so the element does not scroll and the test fails at random (cloudlands-fe#3733: ' +
  '4 of 320 runs; cloudlands-fe#3516, intent-hq/intent#7255). Use ' +
  "`await wheelUntilScrolled(scroller, { deltaY })` from 'src/test/ct-test', which resends " +
  'the wheel until the container scrolls in its direction, then keep your own assertion ' +
  'on the final position. If the test checks that the wheel does NOT scroll, disable this ' +
  'rule on that line with a reason.';

function keyName(property, computed) {
  if (!computed && property.type === 'Identifier') return property.name;
  if (property.type === 'Literal') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0].value.cooked;
  }
  return null;
}

function propertyName(node) {
  if (node?.type !== 'MemberExpression') return null;
  return keyName(node.property, node.computed);
}

function unwrapChain(node) {
  return node?.type === 'ChainExpression' ? node.expression : node;
}

// `page.mouse`, or a name bound to one (`const m = page.mouse`, `const { mouse } = page`).
function isMouse(node, mouseNames) {
  const target = unwrapChain(node);
  if (target?.type === 'Identifier') return mouseNames.has(target.name);
  return propertyName(target) === 'mouse';
}

// `page.mouse.wheel`, or a name bound to it (`const { wheel } = page.mouse`).
function isWheel(node, names) {
  const target = unwrapChain(node);
  if (target?.type === 'Identifier') return names.wheel.has(target.name);
  return propertyName(target) === 'wheel' && isMouse(target.object, names.mouse);
}

const INDIRECT_CALLS = new Set(['call', 'apply', 'bind']);

// The wheel call itself, or `wheel.call(...)` / `.apply(...)` / `.bind(...)`.
function isMouseWheelCall(callee, names) {
  const target = unwrapChain(callee);
  if (isWheel(target, names)) return true;
  return INDIRECT_CALLS.has(propertyName(target)) && isWheel(target.object, names);
}

// Record names a declaration binds to a mouse or to its wheel method.
function recordAliases(declarator, names) {
  const { id, init } = declarator;
  if (!init) return;
  if (id.type === 'Identifier') {
    if (isMouse(init, names.mouse)) names.mouse.add(id.name);
    else if (isWheel(init, names)) names.wheel.add(id.name);
    return;
  }
  if (id.type !== 'ObjectPattern') return;
  for (const property of id.properties) {
    if (property.type !== 'Property' || property.value.type !== 'Identifier') continue;
    const key = keyName(property.key, property.computed);
    if (key === 'mouse') names.mouse.add(property.value.name);
    else if (key === 'wheel' && isMouse(init, names.mouse)) names.wheel.add(property.value.name);
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require wheelUntilScrolled instead of a raw mouse.wheel in a component test, so a wheel Chromium drops is resent.',
    },
    schema: [],
    messages: {
      rawMouseWheel: MESSAGE,
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!filename.endsWith('.ct.spec.ts')) return {};
    const names = { mouse: new Set(['mouse']), wheel: new Set() };
    return {
      VariableDeclarator(node) {
        recordAliases(node, names);
      },
      CallExpression(node) {
        if (isMouseWheelCall(node.callee, names)) {
          context.report({ node, messageId: 'rawMouseWheel' });
        }
      },
    };
  },
};

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
 * `mouse`). The helper module is
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

function propertyName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal') return node.property.value;
  return null;
}

function isMouseWheel(callee) {
  let current = callee;
  if (current?.type === 'ChainExpression') current = current.expression;
  if (propertyName(current) !== 'wheel') return false;
  const { object } = current;
  return (
    propertyName(object) === 'mouse' || (object.type === 'Identifier' && object.name === 'mouse')
  );
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
    return {
      CallExpression(node) {
        if (isMouseWheel(node.callee)) context.report({ node, messageId: 'rawMouseWheel' });
      },
    };
  },
};

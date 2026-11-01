import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects fixed sleeps in a Playwright component test:
 *
 *   await toggle.click();
 *   await page.waitForTimeout(400);            // flagged
 *   await nextToggle.click();
 *
 * A fixed sleep guesses how long motion takes. On a slow runner the motion is still
 * running when the sleep ends, and the next click can press one element and release over
 * another, because Playwright hit-tests only the pointerdown; the browser then drops the
 * click (cloudlands-fe#3955, merge-group run 41203676601). Flakes like this ejected the
 * unrelated cloudlands-fe#3920 from the merge queue. Wait for the motion itself with
 * `clickAndSettle` / `expectMotionToSettle` (src/test/ct-settle.ts, re-exported from
 * src/test/ct-test.ts), or for the end state with `expect(...)` / `expect.poll(...)`.
 *
 * Flagged: every `<x>.waitForTimeout` member access in a `*.ct.spec.ts` file, whatever
 * the receiver (`page`, `component.page()`, `this.page`) and whether it is called
 * directly or through `.call` / `.bind`, plus a `waitForTimeout` destructured from an
 * object.
 *
 * Ratchet: the `baseline` option maps each spec that already had sleeps to its count;
 * the first `count` in source order are tolerated and every further one is reported.
 * Counts may only shrink (eslint-rules/no-wait-for-timeout-in-ct.test.js). A test that
 * must observe a quiet period ("nothing else happens for 400 ms") may keep its sleep by
 * disabling this rule on that line with a reason.
 */

const MESSAGE =
  'Do not add fixed sleeps to component tests: page.waitForTimeout guesses how long motion ' +
  'takes, and on a slow runner the next click lands mid-animation and is silently dropped ' +
  '(Playwright hit-tests only pointerdown; cloudlands-fe#3955, which ejected ' +
  'cloudlands-fe#3920 from the merge queue). Use `await clickAndSettle(control, region)` or ' +
  "`await expectMotionToSettle(region, { changedFrom })` from 'src/test/ct-test', or wait for " +
  'the end state with expect(...) / expect.poll(...). If the test must observe a quiet ' +
  'period (nothing else happens for N ms), disable this rule on that line with a reason.';

function keyName(property, computed) {
  if (!computed && property.type === 'Identifier') return property.name;
  if (property.type === 'Literal') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0].value.cooked;
  }
  return null;
}

const NAME = 'waitForTimeout';
const RULE_NAME = 'no-wait-for-timeout-in-ct';
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow new page.waitForTimeout sleeps in component tests; wait for motion or state instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative spec file → number of sleeps it may still contain.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      fixedSleep: MESSAGE,
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!filename.endsWith('.ct.spec.ts')) return {};
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    const suppressed = suppressedLines(context.sourceCode, RULE_NAME);
    let seen = 0;
    const offend = (node) => {
      if (suppressed(node.loc.start.line)) return;
      seen += 1;
      if (seen > allowed) context.report({ node, messageId: 'fixedSleep' });
    };

    return {
      MemberExpression(node) {
        if (keyName(node.property, node.computed) === NAME) offend(node);
      },
      Property(node) {
        if (node.parent.type === 'ObjectPattern' && keyName(node.key, node.computed) === NAME) {
          offend(node);
        }
      },
    };
  },
};

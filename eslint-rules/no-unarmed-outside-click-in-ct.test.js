// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-unarmed-outside-click-in-ct.js';

const filename = path.resolve('src/lib/components/example/example.ct.spec.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = (line) => ({ messageId: 'unarmedOutsideClick', line });

const inTest = (body) => `
test('dismisses the layer', async ({ mount, page }) => {
${body}
});`;

describe('no-unarmed-outside-click-in-ct guidance', () => {
  it('explains the race, names the helper, and cites the incident', () => {
    const message = rule.meta.messages.unarmedOutsideClick;
    expect(message).toContain('afterSleep(1)');
    expect(message).toContain('await expectDismissibleLayerArmed(layer)');
    expect(message).toContain('cloudlands-fe#3696');
    expect(message).toContain('disable this rule on that line with a reason');
  });
});

tester.run('no-unarmed-outside-click-in-ct', rule, {
  valid: [
    {
      name: 'outside click after the readiness wait',
      filename,
      code: inTest(`
  await trigger.click();
  await expect(menu).toBeVisible();
  await expectDismissibleLayerArmed(menu);
  await page.mouse.click(850, 300);
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'neutral statements between the wait and the click',
      filename,
      code: inTest(`
  await trigger.click();
  await expectDismissibleLayerArmed(menu);
  const box = await page.getByTestId('outside').boundingBox();
  await expect(menu).toBeVisible();
  await page.mouse.click(box.x, box.y);
  await expect(menu).toBeHidden();`),
    },
    {
      name: 'waits for every open layer before one outside click',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(outer);
  await expectDismissibleLayerArmed(inner);
  await page.mouse.click(2, 300);
  await expect(inner).toHaveCount(0);
  await expect(outer).toHaveCount(0);`),
    },
    {
      name: 'wait before an if/else one-liner click',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(dialog);
  if (dismissal === 'outside') await page.mouse.click(5, 5);
  else await page.keyboard.press(dismissal);
  await expect(dialog).toHaveCount(0);`),
    },
    {
      name: 'wait before a block that holds the click',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  if (wide) {
    await page.mouse.click(2, 300);
  }
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'outside locator click after the wait',
      filename,
      code: inTest(`
  await trigger.click();
  await expectDismissibleLayerArmed(popover);
  await outside.click();
  await expect(popover).toBeHidden();`),
    },
    {
      name: 'click followed by an open-state assertion is not a dismissal',
      filename,
      code: inTest(`
  await page.mouse.click(10, 10);
  await expect(dialog).toBeVisible();`),
    },
    {
      name: 'a non-assertion statement ends the dismissal scan',
      filename,
      code: inTest(`
  await page.mouse.click(10, 10);
  await trigger.click();
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'a locator click that does not mention outside',
      filename,
      code: inTest(`
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'a non-zero count is not a closed state',
      filename,
      code: inTest(`
  await page.mouse.click(10, 10);
  await expect(menu).toHaveCount(1);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');`),
    },
    {
      name: 'Escape needs no wait',
      filename,
      code: inTest(`
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'only component-test specs are checked',
      filename: path.resolve('src/lib/components/example/example.test.ts'),
      code: inTest(`
  await page.mouse.click(10, 10);
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'an expect-named assertion helper does not cancel the wait',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  await expectAnimationsToSettle(menu);
  await page.mouse.click(1, 1);
  await expect(menu).toHaveCount(0);`),
    },
    {
      name: 'guard inside the loop body covers each iteration',
      filename,
      code: inTest(`
  for (const point of points) {
    await trigger.click();
    await expectDismissibleLayerArmed(menu);
    await page.mouse.click(point.x, point.y);
    await expect(menu).toHaveCount(0);
  }`),
    },
    {
      name: 'guarded overlay click',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(dialog);
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);`),
    },
  ],
  invalid: [
    {
      name: 'unguarded page.mouse.click dismissal',
      filename,
      code: inTest(`
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(850, 300);
  await expect(menu).toHaveCount(0);`),
      errors: [error(6)],
    },
    {
      name: 'unguarded click on an outside element',
      filename,
      code: inTest(`
  await trigger.click();
  await outside.click();
  await expect(outside).toBeFocused();
  await expect(listbox).toBeHidden();`),
      errors: [error(5)],
    },
    {
      name: 'unguarded click on an outside test id',
      filename,
      code: inTest(`
  await component.getByTestId('outside-target').click();
  await expect(dialog).not.toBeVisible();`),
      errors: [error(4)],
    },
    {
      name: 'aria-expanded false counts as a dismissal',
      filename,
      code: inTest(`
  await page.mouse.click(700, 400);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');`),
      errors: [error(4)],
    },
    {
      name: 'an interaction after the wait cancels it',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  await trigger.click();
  await page.mouse.click(850, 300);
  await expect(menu).toHaveCount(0);`),
      errors: [error(6)],
    },
    {
      name: 'an awaited helper after the wait cancels it',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(dialog);
  await reopenTop();
  await page.mouse.click(40, 40);
  await expect(top).toHaveCount(0);`),
      errors: [error(6)],
    },
    {
      name: 'unguarded if/else one-liner click',
      filename,
      code: inTest(`
  if (dismissal === 'outside') await page.mouse.click(5, 5);
  else await page.keyboard.press(dismissal);
  await expect(dialog).toHaveCount(0);`),
      errors: [error(4)],
    },
    {
      name: 'unguarded click in an else block before the closed assertion',
      filename,
      code: inTest(`
  await effortTrigger.click();
  if (modal) {
    await heading.click();
  } else {
    await page.mouse.click(2, 300);
  }
  await expect(inner).toHaveCount(0);`),
      errors: [error(8)],
    },
    {
      name: 'conditional closed assertion after the click',
      filename,
      code: inTest(`
  await page.mouse.click(1, 1);
  if (modal) await expect(dialog).toHaveCount(0);`),
      errors: [error(4)],
    },
    {
      name: 'the wait before an interaction in the enclosing block does not carry in',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  await trigger.click();
  if (wide) {
    await page.mouse.click(2, 300);
  }
  await expect(menu).toHaveCount(0);`),
      errors: [error(7)],
    },
    {
      name: 'unguarded overlay or backdrop click',
      filename,
      code: inTest(`
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
  await backdrop.click();
  await expect(dialog).toHaveCount(0);`),
      errors: [error(4), error(6)],
    },
    {
      name: 'unguarded dblclick and touchscreen tap',
      filename,
      code: inTest(`
  await page.mouse.dblclick(1, 1);
  await expect(menu).toHaveCount(0);
  await page.touchscreen.tap(1, 1);
  await expect(menu).toHaveCount(0);`),
      errors: [error(4), error(6)],
    },
    {
      name: 'a wait followed by an interaction inside an earlier block does not count',
      filename,
      code: inTest(`
  if (reopen) {
    await expectDismissibleLayerArmed(menu);
    await trigger.click();
  }
  await page.mouse.click(1, 1);
  await expect(menu).toHaveCount(0);`),
      errors: [error(8)],
    },
    {
      name: 'a wait in one branch only does not count',
      filename,
      code: inTest(`
  await trigger.click();
  if (wide) await expectDismissibleLayerArmed(menu);
  await page.mouse.click(1, 1);
  await expect(menu).toHaveCount(0);`),
      errors: [error(6)],
    },
    {
      name: 'an interaction inside test.step cancels the wait',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  await test.step('reopen', async () => {
    await trigger.click();
  });
  await page.mouse.click(1, 1);
  await expect(menu).toHaveCount(0);`),
      errors: [error(8)],
    },
    {
      name: 'a wait before a loop does not cover clicks inside it',
      filename,
      code: inTest(`
  await expectDismissibleLayerArmed(menu);
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await expect(menu).toHaveCount(0);
    await trigger.click();
  }
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect(menu).toHaveCount(0);`),
      errors: [error(6), error(10)],
    },
    {
      name: 'other closed-state assertions count as a dismissal',
      filename,
      code: inTest(`
  await page.mouse.click(1, 1);
  await expect(menu).toBeVisible({ visible: false });
  await outside.click();
  await expect(menu).not.toBeAttached();
  await outside.click();
  await expect(menu).toBeAttached({ attached: false });
  await outside.click();
  await expect(trigger).toHaveAttribute('data-state', 'closed');`),
      errors: [error(4), error(6), error(8), error(10)],
    },
    {
      name: 'a closed assertion after neutral statements or a try block',
      filename,
      code: inTest(`
  await page.mouse.click(1, 1);
  const count = await menu.count();
  await expect(menu).toHaveCount(0);
  try {
    await page.mouse.click(1, 1);
  } finally {
    await log();
  }
  await expect(menu).toHaveCount(0);`),
      errors: [error(4), error(8)],
    },
  ],
});

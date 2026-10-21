import { expect, test } from '../../../test/ct-test';
import Preview from './discussion-reactions.preview.svelte';

const lastRow = '[data-discussion-message="reaction-last"]';

test('five-emoji picker closes on selection, toggles chips and preserves the draft', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { initial: 'empty' } });
  const row = component.locator(lastRow);
  const trigger = row.locator('[data-discussion-reaction-trigger="toolbar"]');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const picker = page.locator('[data-discussion-reaction-picker]');
  await expect(picker.locator('[data-discussion-reaction-choice]')).toHaveCount(5);
  await expect(picker.locator('img')).toHaveCount(5);
  await picker.getByRole('button', { name: 'Eyes', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  const chip = row.locator('[data-discussion-reaction="👀"]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft while reacting',
  );
  await expect(component.locator('[data-reaction-reply]')).toBeEmpty();
});

test('arrow navigation and Escape return focus; focused chips describe human and agent reactors', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const trigger = component.locator(lastRow).locator('[data-discussion-reaction-trigger="plus"]');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const picker = page.locator('[data-discussion-reaction-picker]');
  await expect(picker.getByRole('button', { name: 'Thumbs up', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('button', { name: 'Thumbs down', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(picker.getByRole('button', { name: 'See no evil', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  const chip = component.locator(
    '[data-discussion-message="reaction-first"] [data-discussion-reaction="👀"]',
  );
  await chip.focus();
  await expect(page.getByRole('tooltip')).toContainText('Alex and Developer reacted with');
  await trigger.focus();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await chip.hover();
  await expect(page.getByRole('tooltip')).toContainText('Alex and Developer reacted with');
});

test('bounded roster reports overflow and legacy reactions remain removable', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { initial: 'large' } });
  const eyes = component.locator(lastRow).locator('[data-discussion-reaction="👀"]');
  await eyes.focus();
  await expect(page.getByRole('tooltip')).toContainText('1,214 others');
  await component.unmount();
  const legacy = await mount(Preview, { props: { initial: 'legacy' } });
  const chip = legacy.locator(lastRow).locator('[data-discussion-reaction="🙂"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toHaveAttribute('aria-disabled', 'true');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(chip).toHaveAttribute('aria-label', '🙂, 1 reactions');
});

test('narrow wrapped chips, transient controls and last-row menus never move messages or cover chips', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 300, height: 450 });
  const component = await mount(Preview, { props: { narrow: true } });
  await page.evaluate(() => document.fonts.ready);
  const row = component.locator(lastRow);
  const geometry = () =>
    component
      .locator('[data-discussion-message], [data-discussion-bubble], [data-discussion-reactions]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
  const baseline = await geometry();
  await row.hover();
  const toolbar = row.locator('[data-discussion-message-actions]');
  await expect(toolbar).toHaveCSS('opacity', '1');
  const reactions = (await row.locator('[data-discussion-reactions]').boundingBox())!;
  const actions = (await toolbar.boundingBox())!;
  expect(actions.y).toBeGreaterThanOrEqual(reactions.y + reactions.height);
  expect(await geometry()).toEqual(baseline);
  const trigger = row.locator('[data-discussion-reaction-trigger="plus"]');
  await trigger.click();
  const picker = page.locator('[data-discussion-reaction-picker]');
  await expect(picker).toBeVisible();
  const bounds = (await picker.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(300);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(450);
  expect(await geometry()).toEqual(baseline);
  const controls = await row
    .locator('[data-discussion-reaction], [data-discussion-reaction-trigger="plus"]')
    .all();
  for (const control of controls) {
    const box = (await control.boundingBox())!;
    expect(bounds.y + bounds.height <= box.y || bounds.y >= box.y + box.height).toBe(true);
  }
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click();
  await expect(component.locator('[data-reaction-copied]')).toHaveText(
    'The picker, reactions and reply controls are ready.',
  );
  expect(await geometry()).toEqual(baseline);
});

test.describe('touch reactions', () => {
  test.use({ hasTouch: true });
  test('a tap opens the picker and selection closes it', async ({ mount, page }) => {
    const component = await mount(Preview, { props: { narrow: true } });
    const trigger = component.locator(lastRow).locator('[data-discussion-reaction-trigger="plus"]');
    await expect(trigger).toBeVisible();
    await trigger.tap();
    const picker = page.locator('[data-discussion-reaction-picker]');
    await picker.getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(picker).toBeHidden();
    await expect(
      component.locator(lastRow).locator('[data-discussion-reaction="✅"]'),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

test('picker choices retain accessible labels without tooltips on hover or focus', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const trigger = component.locator(lastRow).locator('[data-discussion-reaction-trigger="plus"]');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const picker = page.locator('[data-discussion-reaction-picker]');
  const thumbsDown = picker.getByRole('button', { name: 'Thumbs down', exact: true });
  await thumbsDown.hover();
  await expect(thumbsDown).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await picker.getByRole('button', { name: 'Eyes', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('both picker entry points add idempotently while chips toggle', async ({ mount, page }) => {
  const component = await mount(Preview);
  const row = component.locator(lastRow);
  const chip = row.locator('[data-discussion-reaction="👍"]');
  for (const entry of ['toolbar', 'plus']) {
    const trigger = row.locator(`[data-discussion-reaction-trigger="${entry}"]`);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page
      .locator('[data-discussion-reaction-picker]')
      .getByRole('button', { name: 'Thumbs up', exact: true })
      .click();
    await expect(page.locator('[data-discussion-reaction-picker]')).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(chip).toHaveAttribute('aria-label', '👍, 2 reactions');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(component.locator('[data-reaction-last]')).toBeEmpty();
  }
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toHaveAttribute('aria-label', '👍, 1 reactions');
});

test('real thread final-row toolbar escapes the scroll clip without moving messages or the composer', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { narrow: true } });
  await page.evaluate(() => document.fonts.ready);
  const row = component.locator(lastRow);
  const scroller = component.locator('[data-discussion-scroll]');
  const geometry = () =>
    component
      .locator('[data-discussion-message], [data-discussion-composer]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const before = await geometry();
  const scrollTop = await scroller.evaluate((el) => el.scrollTop);
  await row.hover();
  const toolbar = row.locator('[data-discussion-message-actions]');
  await expect(toolbar).toHaveCSS('opacity', '1');
  for (const button of await toolbar.getByRole('button').all()) {
    expect(
      await button.evaluate((node) => {
        const b = node.getBoundingClientRect();
        return [0.25, 0.75].every((ratio) =>
          node.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height * ratio)),
        );
      }),
    ).toBe(true);
  }
  expect(await geometry()).toEqual(before);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  await toolbar.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await expect(page.locator('[data-discussion-reaction-picker]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await geometry()).toEqual(before);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft while reacting',
  );
});

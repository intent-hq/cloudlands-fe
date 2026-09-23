import { expect, test } from '../../../../test/ct-test';
import Preview from './modal-heading-spacing.preview.svelte';

for (const kind of [
  'form',
  'confirm',
  'direct',
  'wrapped',
  'workspace',
  'release',
  'replace',
] as const) {
  test(`${kind} dialog aligns its close button with the first title line and preserves dismissal`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { kind } });
    if (kind === 'direct' || kind === 'wrapped')
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const primaryName = {
      form: 'Confirm',
      confirm: 'Confirm',
      direct: 'Delete item',
      wrapped: 'Delete item',
      workspace: 'Create workspace',
      release: 'Got it',
      replace: 'Send',
    }[kind];
    const primary = dialog.getByRole('button', { name: primaryName, exact: true });
    await expect(primary).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    const headerBorders = await dialog.evaluate((node) => {
      const borders: number[] = [];
      let header = node.querySelector('[data-slot=dialog-title]');
      while (header && header !== node) {
        borders.push(parseFloat(getComputedStyle(header).borderBottomWidth));
        header = header.parentElement;
      }
      return borders;
    });
    expect(headerBorders.length).toBeGreaterThan(0);
    expect(
      headerBorders.every((border) => border === 0),
      'borderless modal header',
    ).toBe(true);
    if (kind === 'form' || kind === 'confirm' || kind === 'direct') {
      const gap = await dialog.locator('[data-slot=dialog-header]').evaluate((header) => {
        const next = header.nextElementSibling!;
        return next.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
      });
      // Confirm has no body; preserve its deliberate 24px footer section margin.
      expect(gap).toBeCloseTo(kind === 'confirm' ? 40 : 16, 0);
    }
    const bounds = await dialog.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(420);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
    const title = await dialog.locator('[data-slot=dialog-title]').evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(node).lineHeight),
    }));
    const close = dialog.getByRole('button', { name: /close/i });
    const icon = (await close.locator('svg').boundingBox())!;
    const offset = icon.y + icon.height / 2 - (title.top + title.lineHeight / 2);
    await testInfo.attach('title-close-geometry', {
      body: JSON.stringify({ kind, title, icon, offset }),
      contentType: 'application/json',
    });
    if (kind === 'wrapped') expect(title.height).toBeGreaterThan(title.lineHeight);
    expect(
      Math.abs(offset),
      `${kind}: close icon offset from first title line`,
    ).toBeLessThanOrEqual(1);
    await primary.press('Tab');
    await expect(close).toBeFocused();
    if (kind === 'workspace' || kind === 'release' || kind === 'replace') {
      await close.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Accepted count' })).toHaveText('0');
  });
}

test('simultaneous dialogs each align the close icon to their own title', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { kind: 'stacked' } });
  const dialogs = page.getByRole('dialog');
  await expect(dialogs).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  for (const dialog of await dialogs.all()) {
    const firstLineCenter = await dialog
      .locator('[data-slot=dialog-title]')
      .evaluate(
        (node) =>
          node.getBoundingClientRect().top + parseFloat(getComputedStyle(node).lineHeight) / 2,
      );
    const icon = (await dialog
      .getByRole('button', { name: /close/i })
      .locator('svg')
      .boundingBox())!;
    expect(Math.abs(icon.y + icon.height / 2 - firstLineCenter)).toBeLessThanOrEqual(1);
  }
});

for (const kind of ['form', 'workspace'] as const) {
  test(`${kind}: disabled primary actions focus a field without stealing focus when enabled`, async ({
    mount,
    page,
  }) => {
    const component = await mount(Preview, { props: { kind, primaryDisabled: true } });
    const field = page.getByRole('textbox', {
      name: kind === 'form' ? 'Fixture name' : 'Workspace task',
    });
    await expect(field).toBeFocused();
    await field.fill('Draft');
    await component.update({ props: { primaryDisabled: false } });
    await expect(
      page.getByRole('button', {
        name: kind === 'form' ? 'Confirm' : 'Create workspace',
        exact: true,
      }),
    ).toBeEnabled();
    await expect(field).toBeFocused();
  });
}

test('an explicit input focus override takes priority over the primary action', async ({
  mount,
  page,
}) => {
  await mount(Preview, { props: { focusField: true } });
  await expect(page.getByRole('textbox', { name: 'Fixture name' })).toBeFocused();
});

test('reopening restores primary focus and Enter activates it rather than closing', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  const primary = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(primary).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open fixture' }).click();
  await expect(primary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Accepted count' })).toHaveText('1');
});

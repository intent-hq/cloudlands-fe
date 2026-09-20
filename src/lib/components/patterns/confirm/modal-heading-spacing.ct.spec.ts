import { expect, test } from '../../../../test/ct-test';
import Preview from './modal-heading-spacing.preview.svelte';

for (const kind of ['form', 'confirm', 'direct'] as const) {
  test(`${kind} dialog has one heading gap and preserves keyboard dismissal`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { kind } });
    if (kind === 'direct')
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const gap = await dialog.locator('[data-slot=dialog-header]').evaluate((header) => {
      const next = header.nextElementSibling!;
      return next.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });
    // Confirm has no body; preserve its deliberate 24px footer section margin.
    expect(gap).toBeCloseTo(kind === 'confirm' ? 40 : 16, 0);
    const bounds = await dialog.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(420);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    await close.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Accepted count' })).toHaveText('0');
  });
}

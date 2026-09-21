import { test, expect } from '../../../../test/ct-test';
import Harness from './TaskTypographyHarness.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`matches serif note body and centers task controls in ${theme}`, async ({ mount, page }) => {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(Harness, { props: { theme } });
    const body = await component.locator('[data-note-body]').evaluate((node) => {
      const style = getComputedStyle(node);
      return { font: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
    });
    const title = component.locator('[data-task-row-title]').first();
    await expect(title).toHaveCSS('font-family', body.font);
    await expect(title).toHaveCSS('font-size', body.size);
    await expect(title).toHaveCSS('font-weight', body.weight);
    const row = component.locator('[data-task-item-row]').first();
    const offset = await row.evaluate((node) => {
      const row = node.getBoundingClientRect();
      const checkbox = node.querySelector('[data-task-row-leading]')!.getBoundingClientRect();
      return Math.abs(row.top + row.height / 2 - checkbox.top - checkbox.height / 2);
    });
    expect(offset).toBeLessThanOrEqual(1);
  });
}

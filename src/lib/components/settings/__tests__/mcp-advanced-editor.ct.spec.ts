import { expect, test } from '@playwright/experimental-ct-svelte';
import McpAdvancedEditor from '../mcp-advanced-editor.preview.svelte';

for (const width of [420, 1100]) {
  test(`MCP disclosure stays inside its row and supports keyboard activation at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(McpAdvancedEditor);
    const trigger = root.getByRole('button', { name: /Advanced: Edit Servers as JSON/ });
    const editor = root.getByRole('textbox', { name: 'MCP server configuration JSON' });
    await page.evaluate(() => document.fonts.ready);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const measure = () =>
      trigger.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const label = element.querySelector('[data-slot="button-label"]')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        return {
          topInset: text.top - row.top,
          bottomInset: row.bottom - text.bottom,
          overflow: element.scrollWidth - element.clientWidth,
          height: row.height,
        };
      });
    const initial = await measure();
    expect(initial.topInset).toBeGreaterThanOrEqual(0);
    expect(initial.bottomInset).toBeGreaterThanOrEqual(0);
    expect(initial.overflow).toBeLessThanOrEqual(1);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await measure()).height).toBe(initial.height);
    await trigger.click();
    await expect(editor).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
}

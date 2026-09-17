import { test, expect } from '@playwright/experimental-ct-svelte';
import Preview from './provider-default-models.preview.svelte';

for (const scenario of [
  { name: 'wide light', width: 1000, narrowPane: false, dark: false },
  { name: 'narrow pane in wide dark window', width: 1000, narrowPane: true, dark: true },
  { name: 'small window', width: 320, narrowPane: false, dark: false },
]) {
  test(`default model controls align and remain operable: ${scenario.name}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      scenario.dark,
    );
    const quickActionDefaultModel = 'codex:codex-preview-balanced';
    const root = await mount(Preview, {
      props: { narrowPane: scenario.narrowPane, quickActionDefaultModel },
    });
    await page.evaluate(() => document.fonts.ready);
    const rows = root.locator('[data-slot="settings-field-row"]');
    await expect(rows).toHaveCount(5);
    const edges = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const rect = row.getBoundingClientRect();
        const trigger = row
          .querySelector('button[aria-haspopup="listbox"]')!
          .getBoundingClientRect();
        return {
          right: trigger.right,
          rowRight: rect.right,
          left: trigger.left,
          rowLeft: rect.left,
        };
      }),
    );
    for (const edge of edges) {
      expect(Math.abs(edge.right - edge.rowRight)).toBeLessThan(1);
      expect(Math.abs(edge.right - edges[0].right)).toBeLessThan(1);
      expect(edge.left).toBeGreaterThanOrEqual(edge.rowLeft);
    }
    const reset = root.getByRole('button', { name: 'Reset all to default' });
    const main = root.locator('#default-agent-model button[aria-haspopup="listbox"]');
    const a = (await reset.boundingBox())!;
    const b = (await main.boundingBox())!;
    expect(a.x + a.width <= b.x || a.y + a.height <= b.y).toBe(true);
    const overrides = root.getByTestId('model-action-overrides');
    const heading = overrides.getByRole('heading');
    const sectionBox = (await overrides.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;
    expect(headingBox.y - sectionBox.y).toBeGreaterThanOrEqual(16);
    expect(
      (await rows.nth(2).boundingBox())!.y - headingBox.y - headingBox.height,
    ).toBeGreaterThanOrEqual(16);
    await expect(overrides).toHaveCSS('border-top-width', '1px');
    await expect(main.locator('[data-slot="button-surface"]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // Real override selection, not a geometry-only mock: inherited selection
    // clears only that action and leaves the general quick-action default alone.
    const commit = root.locator('#background-agent-commit button[aria-haspopup="listbox"]');
    const defaults = root.getByTestId('defaults-state');
    await expect(defaults).toContainText(`"defaultModel":"${quickActionDefaultModel}"`);
    await expect(defaults).toContainText('"commit":"claude-code:claude-code-preview-deep"');
    await commit.click();
    await page.getByRole('option', { name: /Use default quick action model/ }).click();
    await expect(defaults).toContainText('"commit":""');
    await expect(defaults).toContainText(`"defaultModel":"${quickActionDefaultModel}"`);
    await commit.click();
    await expect(
      page.getByRole('option', { name: /Use default quick action model/ }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(commit).toBeFocused();
  });
}

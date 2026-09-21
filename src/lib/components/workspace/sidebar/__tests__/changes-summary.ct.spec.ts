import { expect, test } from '../../../../../test/ct-test';
import Preview from '../changes-summary.preview.svelte';

for (const { width, locked } of [
  { width: 360, locked: false },
  { width: 280, locked: true },
]) {
  test(`branch fields remain usable at ${width}px with ${locked ? 'locked' : 'selectable'} target`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { locked } });
    const summary = page.locator('[data-branch-summary]');
    await expect(summary).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await summary.evaluate((root) => {
      const box = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('button,input')].map((node) => {
        const r = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          weight: style.fontWeight,
          border: style.borderTopWidth,
        };
      });
      const labels = [...root.querySelectorAll('.branch-label')].map((node) => ({
        height: node.getBoundingClientRect().height,
        weight: getComputedStyle(node).fontWeight,
      }));
      return { x: box.x, width: box.width, controls, labels };
    });
    expect(geometry.controls).toHaveLength(2);
    for (const control of geometry.controls) {
      expect(control.x).toBeCloseTo(geometry.x, 1);
      expect(control.width).toBeCloseTo(geometry.width, 1);
      expect(control.weight).toBe('400');
      expect(control.border).toBe('1px');
    }
    expect(geometry.controls[1].y).toBeGreaterThan(
      geometry.controls[0].y + geometry.controls[0].height,
    );
    for (const label of geometry.labels) {
      expect(label.height).toBeGreaterThan(0);
      expect(label.weight).toBe('400');
    }
    const working = summary.locator('[data-branch-field="working"]');
    await working.getByRole('button').focus();
    await page.keyboard.press('Enter');
    const input = working.getByRole('textbox');
    await expect(input).toBeFocused();
    expect((await input.boundingBox())!.width).toBeCloseTo(geometry.width, 1);
    await input.fill('feature/cancelled-draft');
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(working.getByRole('button')).not.toContainText('cancelled-draft');
    const target = summary.locator('[data-branch-field="target"]');
    if (locked) {
      await expect(target.getByRole('textbox')).toHaveAttribute('readonly', '');
      await expect(target.getByRole('combobox')).toHaveCount(0);
    } else {
      await target.getByRole('combobox').focus();
      await page.keyboard.press('Enter');
      await expect(target.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[data-slot="select-content"] input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(target.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
      await expect(target.getByRole('combobox')).toBeFocused();
    }
    const header = page.locator('[data-sidebar-card-tab="changes"] h6');
    const refresh = header.getByRole('button', { name: 'Refresh git status' });
    await expect(page.locator('.sidebar-changes-container [data-changes-refresh]')).toHaveCount(0);
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(refresh).toBeDisabled();
    await expect(refresh).toBeEnabled();
    const root = page.getByRole('combobox', { name: 'Select git root' });
    await root.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'packages/component' }).click();
    await expect(page.getByTestId('secondary-root-changes-view')).toBeVisible();
    await expect(header.locator('[data-changes-refresh]')).toHaveCount(1);
    await expect(
      page.getByTestId('secondary-root-changes-view').locator('[data-changes-refresh]'),
    ).toHaveCount(0);
    const close = header.getByRole('button', { name: 'Close tab' });
    expect((await refresh.boundingBox())!.y).toBe((await close.boundingBox())!.y);
  });
}

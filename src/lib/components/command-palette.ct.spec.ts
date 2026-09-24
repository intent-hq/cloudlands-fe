import { expect, test } from '../../test/ct-test';
import CommandPalettePreview from './command-palette.preview.svelte';

test('GitLab command supports keyboard activation and reopening at compact width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CommandPalettePreview, {
    props: { initialQuery: 'GitLab', withoutWorkspace: true },
    hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'gitlab-off' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await expect(input).toBeFocused();
  const enable = dialog.getByRole('button', { name: /Enable experimental GitLab/i });
  await expect(enable).toBeVisible();
  const box = (await enable.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Open palette' }).click();
  await expect(input).toBeFocused();
  await dialog.getByRole('button', { name: /Disable experimental GitLab/i }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Open palette' }).click();
  await expect(enable).toBeVisible();
});

for (const width of [1280, 360]) {
  test(`palette keeps multiline rows, action pills, and footer contained at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(CommandPalettePreview, {
      hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'grouped' } },
    });
    const dialog = page.getByRole('dialog');
    const input = dialog.getByRole('textbox');
    await expect(input).toBeFocused();
    const rows = dialog.locator('[data-palette-result]');
    await expect(rows).toHaveCount(5);
    const geometry = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const box = row.getBoundingClientRect();
        const content = row
          .querySelector('[data-slot="action-row-content"]')!
          .getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          contentTop: content.top,
          contentBottom: content.bottom,
          overflow: row.scrollHeight - row.clientHeight,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.contentTop).toBeGreaterThanOrEqual(row.top);
      expect(row.contentBottom).toBeLessThanOrEqual(row.bottom);
      expect(row.overflow).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < geometry.length; index++) {
      expect(geometry[index].top).toBeGreaterThanOrEqual(geometry[index - 1].bottom);
    }
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(
      await dialog.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const pill of await dialog.locator('[data-slot="button"]').all()) {
      const pillBox = (await pill.boundingBox())!;
      expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(box.x + box.width);
    }
    await input.press('Tab');
    await expect(input).toBeFocused();
  });
}

test('palette show-more filtering preserves keyboard focus and scrolls the current row into view', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CommandPalettePreview, {
    hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'grouped' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await dialog.getByRole('button', { name: /Show .* more notes/ }).click();
  await expect(input).toHaveValue('#');
  await expect(input).toBeFocused();
  const rows = dialog.locator('[data-palette-result]');
  await expect(rows).toHaveCount(16);
  for (let index = 0; index < 20; index++) await input.press('ArrowDown');
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
  const viewport = dialog.locator('[data-palette-results]');
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(rows.last()).toBeInViewport();
  await expect(input).toBeFocused();
  await input.press('ArrowUp');
  await expect(rows.nth(14)).toHaveAttribute('aria-current', 'true');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(dialog).toBeVisible();
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
});

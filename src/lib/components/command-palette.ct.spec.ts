import { expect, test } from '../../test/ct-test';
import CommandPalettePreview from './command-palette.preview.svelte';

test('ordinary open clears the visible recovery filter without disrupting typing or go-to-line', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(CommandPalettePreview, {
    props: { initialQuery: 'GitLab', withoutWorkspace: true },
    hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'gitlab-off' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await expect(input).toHaveValue('GitLab');
  await component.update({ props: { initialQuery: '', withoutWorkspace: true } });
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await input.fill('my search');
  await component.update({ props: { initialQuery: '', withoutWorkspace: false } });
  await expect(input).toHaveValue('my search');
  await component.update({ props: { initialQuery: ':', withoutWorkspace: false } });
  await expect(input).toHaveValue(':');
  await input.fill(':42');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
});

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
  test(`palette keeps results and filters on one line at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(CommandPalettePreview, {
      hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'grouped' } },
    });
    const dialog = page.getByRole('dialog');
    const input = dialog.getByRole('textbox');
    await expect(input).toBeFocused();
    const rows = dialog.locator('[data-palette-result]');
    await expect(rows).toHaveCount(7);
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
          contentHeight: content.height,
          lineHeight: parseFloat(getComputedStyle(row).lineHeight),
          overflow: row.scrollHeight - row.clientHeight,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.contentTop).toBeGreaterThanOrEqual(row.top);
      expect(row.contentBottom).toBeLessThanOrEqual(row.bottom);
      expect(row.contentHeight).toBeLessThanOrEqual(row.lineHeight + 1);
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
    const filters = dialog.getByRole('group', { name: 'Filter results' });
    const filterTops = await filters
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
    expect(Math.max(...filterTops) - Math.min(...filterTops)).toBeLessThanOrEqual(1);
    await testInfo.attach(`single-line-palette-${width}px`, {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
    await input.press('Shift+Tab');
    await expect(input).toHaveValue('~');
    const lastFilter = filters.getByRole('button', { name: 'Changes', exact: true });
    await expect(lastFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(lastFilter).toBeInViewport({ ratio: 1 });
    await input.press('Tab');
    await expect(input).toHaveValue('');
    await expect(filters.getByRole('button', { name: 'All', exact: true })).toBeInViewport({
      ratio: 1,
    });
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

test('category controls preserve the query, support keyboard cycling, and recover from empty results', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 740 });
  await mount(CommandPalettePreview, {
    hooksConfig: { geometrySnapshot: { scene: 'command-palette', state: 'grouped' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  await input.fill('context');
  await filters.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(input).toHaveValue('#context');
  await expect(input).toBeFocused();
  await expect(dialog.locator('[data-palette-result]')).toHaveCount(16);
  await input.press('Tab');
  await expect(input).toHaveValue('/context');
  await input.press('Shift+Tab');
  await expect(input).toHaveValue('#context');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(input).toHaveValue('context');

  await filters.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(input).toHaveValue('~context');
  await expect(input).toBeFocused();
  await input.fill('~');
  await expect(dialog.locator('[data-palette-result]')).toHaveCount(2);

  await input.fill('#no-matching-context-xyz');
  await expect(dialog.getByText('No results found for "no-matching-context-xyz"')).toBeVisible();
  await testInfo.attach('empty-results', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await testInfo.attach('command-palette-redesigned', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
});

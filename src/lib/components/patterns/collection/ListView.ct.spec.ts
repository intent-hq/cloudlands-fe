import { expect, test } from '../../../../test/ct-test';
import CollectionStateHarness from './CollectionStateHarness.svelte';

test('virtual rows fill the viewport on mount and resize without scrolling', async ({
  mount,
  page,
}) => {
  await mount(CollectionStateHarness, { props: { count: 300 } });
  const list = page.getByRole('list');
  const rows = list.getByRole('listitem');

  // Four visible 48px rows plus the default four-row overscan.
  await expect(rows).toHaveCount(8);
  await expect(list).toHaveJSProperty('scrollTop', 0);

  await list.evaluate((element) => {
    element.style.height = '480px';
  });

  // Ten visible rows plus overscan, with no scroll event to refresh the range.
  await expect(rows).toHaveCount(14);
  await expect(rows.nth(9)).toBeInViewport();
  await expect(list).toHaveJSProperty('scrollTop', 0);
});

test('selected backgrounds follow virtual rows after scrolling', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CollectionStateHarness, {
    props: { count: 300, selectable: 'single' },
  });
  const list = page.getByRole('listbox');
  await list.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const index = await list.getByRole('option').last().getAttribute('data-list-index');
  const row = list.locator(`[data-list-index="${index}"]`);
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.mouse.move(0, 0);
  const highlight = list.locator('[data-proximity-highlight="selected"]').first();
  await expect
    .poll(async () => {
      const selected = await row.boundingBox();
      const fill = await highlight.boundingBox();
      if (!selected || !fill) return Infinity;
      return Math.max(
        Math.abs(fill.y - selected.y),
        Math.abs(fill.x - selected.x),
        Math.abs(fill.width - selected.width),
        Math.abs(fill.height - selected.height),
      );
    })
    .toBeLessThan(1);
  await testInfo.attach('scrolled-selection-geometry', {
    body: JSON.stringify({
      row: await row.boundingBox(),
      highlight: await highlight.boundingBox(),
    }),
    contentType: 'application/json',
  });
  await testInfo.attach('scrolled-selection', {
    body: await list.screenshot({ path: testInfo.outputPath('scrolled-selection.png') }),
    contentType: 'image/png',
  });
});

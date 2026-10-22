import type { Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import CollectionStateHarness from './CollectionStateHarness.svelte';
import ControlledSelectionHarness from './ControlledSelectionHarness.svelte';

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

/** Harness rows are labelled with their key capitalised (`alpha` → "Alpha"). */
async function expectSelectionMatchesOwner(page: Page) {
  const owner = page.getByRole('status', { name: 'Owner selection' });
  const options = page.getByRole('listbox', { name: 'Controlled selection' }).getByRole('option');
  await expect
    .poll(async () => {
      const ownerId = (await owner.textContent())?.trim() ?? 'none';
      const selected = await options.evaluateAll((rows) =>
        rows
          .filter((row) => row.getAttribute('aria-selected') === 'true')
          .map((row) => row.textContent?.trim().toLowerCase() ?? ''),
      );
      const expected = ownerId === 'none' ? [] : [ownerId];
      // Return the mismatch itself so a failure prints both sides.
      return JSON.stringify(selected) === JSON.stringify(expected)
        ? 'match'
        : { expected, selected };
    })
    .toBe('match');
}

test('selection stays on the owner state when it deselects and reselects in one frame', async ({
  mount,
  page,
}) => {
  await mount(ControlledSelectionHarness);
  const listbox = page.getByRole('listbox', { name: 'Controlled selection' });
  const owner = page.getByRole('status', { name: 'Owner selection' });
  const beta = listbox.getByRole('option', { name: 'Beta' });
  await expect(beta).toHaveAttribute('aria-selected', 'true');

  // Clicking the selected row reports [] and onActivate re-selects it before the next frame.
  await beta.click();
  await expect(owner).toHaveText('beta');
  await expect(beta).toHaveAttribute('aria-selected', 'true');
  await expectSelectionMatchesOwner(page);

  const alpha = listbox.getByRole('option', { name: 'Alpha' });
  await alpha.click();
  await expect(owner).toHaveText('alpha');
  await alpha.click();
  await expect(owner).toHaveText('alpha');
  await expect(alpha).toHaveAttribute('aria-selected', 'true');
  await expect(beta).toHaveAttribute('aria-selected', 'false');
  await expectSelectionMatchesOwner(page);
});

test('selection does not change without the owner accepting it', async ({ mount, page }) => {
  await mount(ControlledSelectionHarness, { props: { reportChanges: false } });
  const listbox = page.getByRole('listbox', { name: 'Controlled selection' });
  const alpha = listbox.getByRole('option', { name: 'Alpha' });
  const beta = listbox.getByRole('option', { name: 'Beta' });

  await alpha.click();
  await beta.click();
  await alpha.press('Enter');
  await expect(page.getByRole('status', { name: 'Owner selection' })).toHaveText('beta');
  await expect(alpha).toHaveAttribute('aria-selected', 'false');
  await expect(beta).toHaveAttribute('aria-selected', 'true');
  await expectSelectionMatchesOwner(page);
});

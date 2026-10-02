import { test, expect } from '../../../../test/ct-test';
import PendingSearch from './combobox-pending.test-harness.svelte';

test.use({ hasTouch: true });

for (const pointer of ['mouse', 'touch'] as const) {
  for (const selection of ['changed single', 'same single', 'multiple'] as const) {
    test(`native ${pointer} ${selection} waits for a settled search activation`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const multiple = selection === 'multiple';
      const value = multiple ? ['grace'] : selection === 'same single' ? 'ada' : 'grace';
      const component = await mount(PendingSearch, { props: { value, multiple } });
      const input = page.getByRole('combobox', { name: 'People' });
      await input.fill('Ada');
      await expect(input).toHaveAttribute('aria-busy', 'true');
      const option = page.getByRole('option', { name: 'Ada Lovelace' });
      await expect(option).toHaveAttribute('aria-disabled', 'true');

      // Coordinate input deliberately bypasses Playwright's disabled-element wait;
      // it still uses the browser's native hit testing and pointer/click sequence.
      // Disabled rows use pointer-events:none, so their center must hit the listbox,
      // not the option itself or the page beneath an as-yet unpositioned popup.
      await option.scrollIntoViewIfNeeded();
      let point = { x: 0, y: 0, hitsListbox: false };
      await expect
        .poll(async () => {
          point = await option.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, hitsListbox: node.closest('[role="listbox"]')?.contains(hit) ?? false };
          });
          return point.hitsListbox;
        })
        .toBe(true);
      if (pointer === 'mouse') await page.mouse.click(point.x, point.y);
      else await page.touchscreen.tap(point.x, point.y);
      await expect(page.getByLabel('Selected people')).toHaveText(JSON.stringify(value));
      await expect(page.getByLabel('People changes')).toHaveText('0');
      await expect(page.getByLabel('People commits')).toHaveText('0');
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await expect(input).toHaveAttribute('aria-busy', 'true');
      await expect(input).toHaveValue('Ada');

      // Prop-driven promise settlement does not focus/click outside the picker.
      await component.update({ props: { value, multiple, settled: true } });
      await expect(input).toHaveAttribute('aria-busy', 'false');
      await expect(option).toBeEnabled();
      await expect(page.getByLabel('People changes')).toHaveText('0');
      await expect(page.getByLabel('People commits')).toHaveText('0');
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await expect(input).toHaveValue('Ada');

      if (pointer === 'mouse') await option.click();
      else await option.tap();
      await expect(page.getByLabel('Selected people')).toHaveText(
        JSON.stringify(multiple ? ['grace', 'ada'] : 'ada'),
      );
      await expect(page.getByLabel('People changes')).toHaveText(
        selection === 'same single' ? '0' : '1',
      );
      await expect(page.getByLabel('People commits')).toHaveText('1');
      await expect(page.getByLabel('Accepted person')).toHaveText(
        JSON.stringify({ value: 'ada', label: 'Ada Lovelace', data: 'settled' }),
      );
      await expect(input).toHaveAttribute('aria-expanded', String(multiple));
      await expect(input).toHaveValue(multiple ? '' : 'Ada Lovelace');
    });
  }
}

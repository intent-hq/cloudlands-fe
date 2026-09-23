import { expect, test } from '../../../../test/ct-test';
import AccordionHarness from './AccordionHarness.svelte';

test('closed content occupies no space after primitive measurement updates', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(AccordionHarness);
  const second = page.getByRole('button', { name: 'Second section' });
  const panel = page.locator('[data-accordion-content]').filter({ hasText: 'Second panel' });
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(0);
  await second.click();
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(0);
  await second.click();
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(0);
});

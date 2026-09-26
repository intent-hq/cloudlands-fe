import { test, expect } from './ct-test';
import Harness from './fixtures/CtBrowserHarness.svelte';

test('pinned CT browser completes mount update unmount and remount', async ({ mount, page }) => {
  await page.evaluate(() => {
    const events: string[] = [];
    Object.assign(window, { ctHarnessEvents: events });
    for (const name of ['ct-harness-mounted', 'ct-harness-unmounted']) {
      window.addEventListener(name, () => events.push(name));
    }
  });
  const component = await mount(Harness, { props: { label: 'Initial', step: 2 } });
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('Initial: 2');
  await component.update({ props: { label: 'Updated', step: 3 } });
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('Updated: 5');
  await component.unmount();
  await expect(page.getByRole('button')).toHaveCount(0);
  const remounted = await mount(Harness, { props: { label: 'Remounted', step: 1 } });
  await expect(page.getByRole('button')).toHaveText('Remounted: 0');
  await remounted.unmount();
  expect(
    await page.evaluate(() => (window as unknown as { ctHarnessEvents: string[] }).ctHarnessEvents),
  ).toEqual([
    'ct-harness-mounted',
    'ct-harness-unmounted',
    'ct-harness-mounted',
    'ct-harness-unmounted',
  ]);
});

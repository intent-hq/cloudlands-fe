import { expect, test } from '../../../../test/ct-test';
import Harness from './gitlab-resource-hover.test-harness.svelte';

for (const action of ['Retire connection', 'Unmount links']) {
  test('releases the original resource capture after ' + action, async ({ mount, page }) => {
    await mount(Harness);
    await page.getByTestId('mr-link').hover();
    await expect(page.getByTestId('hover-control')).toHaveAttribute('data-requests', '1');
    await page.evaluate(
      (action) =>
        window.dispatchEvent(new CustomEvent('resource-hover-control', { detail: action })),
      action,
    );
    await expect(page.getByTestId('hover-control')).toHaveAttribute('data-releases', '1');
  });
}

test('an unconfigured host remains an ordinary link without detail traffic', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await page.getByTestId('foreign-link').hover();
  await expect(page.getByTestId('hover-control')).toHaveAttribute('data-releases', '1');
  await expect(page.getByTestId('hover-control')).toHaveAttribute('data-requests', '0');
  await expect(page.getByTestId('foreign-link')).toHaveAttribute('href', /foreign\.example\.test/);
});

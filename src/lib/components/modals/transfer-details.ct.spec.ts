import { expect, test } from '../../../test/ct-test';
import Preview from './transfer-audit.preview.svelte';

test('transfer details expand without hiding the decision or consequences', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await mount(Preview, { props: { state: 'plan' } });
  const details = page.getByRole('button', { name: 'Transfer details', exact: true });
  const tables = page.getByTestId('transfer-tables');
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  const content = page.getByTestId('transfer-details-content');
  await expect(content).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => content.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  await expect(page.getByTestId('transfer-warnings')).toBeVisible();
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(tables).toBeVisible();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
    1,
  );
  const start = page.getByRole('button', { name: 'Start transfer', exact: true });
  await expect(start).toBeInViewport();
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => content.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  await expect(page.getByTestId('transfer-warnings')).toBeVisible();
});

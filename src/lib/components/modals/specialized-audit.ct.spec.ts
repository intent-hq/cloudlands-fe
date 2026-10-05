import { expect, test } from '../../../test/ct-test';
import Preview from './specialized-audit.preview.svelte';

test('usage loading does not present zero usage as a completed result', async ({ mount, page }) => {
  await mount(Preview, { props: { state: 'stats-loading' } });
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByText('Tokens processed', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Close/ })).toBeVisible();
});

test('usage failure is visible and does not show a false empty result', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await mount(Preview, { props: { state: 'stats-error' } });
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(page.getByText('Tokens processed', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Close/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('usage period controls reflect the selected mode', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await mount(Preview, { props: { state: 'stats-empty' } });
  const month = page.getByRole('button', { name: 'Month', exact: true });
  const day = page.getByRole('button', { name: '24H', exact: true });
  await expect(month).toHaveAttribute('aria-pressed', 'true');
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(month).toHaveAttribute('aria-pressed', 'false');
});

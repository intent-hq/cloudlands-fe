import { expect, test } from '../../../test/ct-test';
import Preview from './reading-audit.preview.svelte';

test('URL validation remains visible after Enter and clears when corrected', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await mount(Preview, { props: { state: 'context-browser' } });
  const input = page.getByRole('textbox');
  await input.fill('https://');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveAttribute('aria-describedby', 'url-input-error');
  await input.fill('https://example.com');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
});

test('long release notes scroll while the dismissal stays reachable', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await mount(Preview, { props: { state: 'release-long' } });
  const dismiss = page.getByRole('button', { name: 'Got it', exact: true });
  await expect(dismiss).toBeInViewport();
  await page.getByRole('heading', { name: 'Update 15', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Update 15', exact: true })).toBeInViewport();
  await expect(dismiss).toBeInViewport();
  expect(
    await page.getByRole('dialog').evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  await dismiss.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

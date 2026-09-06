import { expect, test } from '@playwright/experimental-ct-svelte';
import SemanticMapCanvasHost from './SemanticMapCanvasHost.svelte';

test('the application wrapper owns focus and region keyboard navigation', async ({
  mount,
  page,
}) => {
  const component = await mount(SemanticMapCanvasHost);
  const application = component.getByRole('application');
  const selected = component.getByTestId('selected-region');

  await component.getByTestId('before-map').focus();
  await page.keyboard.press('Tab');
  await expect(application).toBeFocused();
  await expect(application.locator('canvas')).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(selected).toHaveAttribute('data-region', 'first');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(selected).toHaveAttribute('data-region', 'second');

  await page.keyboard.press('Escape');
  await expect(selected).toHaveAttribute('data-region', '');
});

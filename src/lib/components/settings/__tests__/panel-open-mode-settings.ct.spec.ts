import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelOpenModeSettingsHost from './mocks/PanelOpenModeSettingsHost.svelte';

test('toggles the global panel open mode from the keyboard', async ({ mount, page }) => {
  const component = await mount(PanelOpenModeSettingsHost);
  const toggle = component.getByRole('switch', { name: 'Open new panels pinned' });

  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(component).toHaveAttribute('data-panel-open-mode', 'normal');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(component).toHaveAttribute('data-panel-open-mode', 'pin');

  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(component).toHaveAttribute('data-panel-open-mode', 'normal');
});

test('toggles panel stacking between right and left in every open mode', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelOpenModeSettingsHost, {
    props: { initialMode: 'pin', initialDirection: 'right' },
  });
  const toggle = component.getByRole('switch', { name: 'Panel stacking direction' });

  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(component).toHaveAttribute('data-panel-stack-direction', 'right');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(component).toHaveAttribute('data-panel-stack-direction', 'left');
  await expect(component).toHaveAttribute('data-panel-open-mode', 'pin');
});

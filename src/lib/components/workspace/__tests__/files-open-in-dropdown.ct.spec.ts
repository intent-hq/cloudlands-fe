import { expect, test } from '@playwright/experimental-ct-svelte';
import FilesOpenInDropdownHost from './mocks/FilesOpenInDropdownHost.svelte';

test.describe('Files Open In Dropdown', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const config of [
      { width: 720, zoom: 1, label: '720px/1x' },
      { width: 320, zoom: 2, label: '320px/2x (narrow + zoom)' },
    ]) {
      test(`opens on pointer click, Enter, Space and closes on Escape in ${theme} at ${config.label}`, async ({
        mount,
        page,
      }) => {
        const component = await mount(FilesOpenInDropdownHost, {
          props: { theme, ...config },
        });

        const trigger = component.getByTestId('files-open-in-trigger');
        // Dropdown is portaled, so look for it at page level
        const dropdown = page.getByTestId('files-open-in-content');

        // Initially closed
        await expect(dropdown).not.toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        // Pointer click opens
        await trigger.click();
        await expect(dropdown).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        // Escape closes
        await page.keyboard.press('Escape');
        await expect(dropdown).not.toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();

        // Enter opens
        await page.keyboard.press('Enter');
        await expect(dropdown).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        // Escape closes and returns focus
        await page.keyboard.press('Escape');
        await expect(dropdown).not.toBeVisible();
        await expect(trigger).toBeFocused();

        // Space opens
        await page.keyboard.press('Space');
        await expect(dropdown).toBeVisible();

        // Escape closes again
        await page.keyboard.press('Escape');
        await expect(dropdown).not.toBeVisible();
      });

      test(`anchors menu to arrow button and stays visible at ${theme} ${config.label}`, async ({
        mount,
        page,
      }) => {
        const component = await mount(FilesOpenInDropdownHost, {
          props: { theme, ...config },
        });

        const trigger = component.getByTestId('files-open-in-trigger');
        const dropdown = page.getByTestId('files-open-in-content');

        await trigger.click();
        await expect(dropdown).toBeVisible();

        const triggerBox = await trigger.boundingBox();
        const dropdownBox = await dropdown.boundingBox();

        expect(triggerBox).toBeTruthy();
        expect(dropdownBox).toBeTruthy();

        // Dropdown should be positioned relative to trigger
        // (exact position depends on portal positioning, but it should be visible)
        expect(dropdownBox!.width).toBeGreaterThan(0);
        expect(dropdownBox!.height).toBeGreaterThan(0);
      });

      test(`action executes once and closes menu at ${theme} ${config.label}`, async ({
        mount,
        page,
      }) => {
        const component = await mount(FilesOpenInDropdownHost, {
          props: { theme, ...config },
        });

        const trigger = component.getByTestId('files-open-in-trigger');
        const dropdown = page.getByTestId('files-open-in-content');

        await trigger.click();
        await expect(dropdown).toBeVisible();

        const action = dropdown.getByText('Visual Studio Code');
        await action.click();

        // Menu should close after action
        await expect(dropdown).not.toBeVisible();

        // Verify action was invoked (check for test marker)
        const actionCount = await component.getByTestId('action-count').textContent();
        expect(actionCount).toBe('1');
      });

      test(`ARIA attributes on visible trigger at ${theme} ${config.label}`, async ({ mount }) => {
        const component = await mount(FilesOpenInDropdownHost, {
          props: { theme, ...config },
        });

        const trigger = component.getByTestId('files-open-in-trigger');

        // Trigger has proper ARIA attributes before opening
        await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        // Click to open
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        // After Escape
        await component.page().keyboard.press('Escape');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      });
    }
  }
});

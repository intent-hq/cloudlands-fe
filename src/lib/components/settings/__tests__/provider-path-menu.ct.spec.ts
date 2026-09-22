import { expect, test } from '../../../../test/ct-test';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '../../../../shared/types/provider-availability';
import ProviderPathMenuHost from './mocks/ProviderPathMenuHost.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];

const triggerName = 'Provider actions for Augment Auggie';
const formName = 'Augment Auggie CLI Path';

async function openPathFormWithKeyboard(page: Page) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: triggerName, exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  const firstItem = menu.getByRole('menuitem', { name: 'Set custom path', exact: true });
  await expect(firstItem).toBeFocused();
  const inset = await firstItem.evaluate((item) => {
    const surface = item.closest('[role="menu"]')!;
    const surfaceRect = surface.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const style = getComputedStyle(surface);
    // Exclude the shell border: a border alone must not pass as row padding.
    return {
      left: itemRect.left - surfaceRect.left - parseFloat(style.borderLeftWidth),
      right: surfaceRect.right - itemRect.right - parseFloat(style.borderRightWidth),
    };
  });
  expect(inset.left).toBeGreaterThan(0);
  expect(inset.right).toBeGreaterThan(0);
  expect(inset.left).toBeCloseTo(inset.right, 1);
  await page.keyboard.press('Enter');

  const form = page.getByRole('dialog', { name: formName, exact: true });
  await expect(form).toBeVisible();
  // Wait for the menu's actual teardown before checking its close-autofocus
  // did not steal focus back from the newly mounted production path form.
  await expect(menu).toHaveCount(0);
  await expect(form.getByRole('textbox', { name: formName, exact: true })).toBeFocused();
  return { trigger, form };
}

test.beforeEach(async ({ mount, page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ProviderPathMenuHost, {
    hooksConfig: {
      // The standard CT bridge rejects unscripted methods. No native chooser,
      // daemon connection, or real settings write is available in this fixture.
      mockBackend: {
        'settings.get': {
          path: 'providers.paths',
          value: {},
          origin: 'default',
          revision: 1,
          definition: {
            path: 'providers.paths',
            label: 'Provider paths',
            description: 'CLI executable overrides',
            category: 'providers',
            type: 'object',
            defaultValue: {},
          },
        },
      },
      mockIpc: {
        [PROVIDERS_CHANNELS.GET_AVAILABILITY]: {
          success: true,
          data: {
            hasAnyProvider: true,
            providers: Object.fromEntries(
              Object.entries(PROVIDER_AVAILABILITY_KEY_TO_ID).map(([key, id]) => [
                key,
                { available: id === 'auggie', authenticated: id === 'auggie' },
              ]),
            ),
            hiddenProviders: [],
          },
        },
        [PROVIDERS_CHANNELS.GET_PATHS]: {
          success: true,
          data: { paths: { auggie: '/fixture/bin/auggie' }, secondaryPaths: {} },
        },
      },
    },
  });
});

test('provider keyboard action transfers focus to the path form and Escape returns it', async ({
  page,
}) => {
  const { trigger, form } = await openPathFormWithKeyboard(page);
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Choose file', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('reopened provider path form dismisses on outside pointer without stealing clicked focus', async ({
  page,
}) => {
  const first = await openPathFormWithKeyboard(page);
  await page.keyboard.press('Escape');
  await expect(first.form).toHaveCount(0);
  await expect(first.trigger).toBeFocused();

  const { form, trigger } = await openPathFormWithKeyboard(page);
  const outside = page.getByRole('button', { name: 'Outside action', exact: true });
  const formBounds = await form.boundingBox();
  const outsideBounds = await outside.boundingBox();
  expect(formBounds).not.toBeNull();
  expect(outsideBounds).not.toBeNull();
  // Establish real outside-pointer geometry, not jsdom's synthetic focusout.
  expect(outsideBounds!.x).toBeGreaterThan(formBounds!.x + formBounds!.width);
  await outside.click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('outside-clicks')).toHaveText('1');
  await expect(outside).toBeFocused();
  await expect(trigger).not.toBeFocused();
  // A subsequent keyboard activation must still hit the clicked control.
  await page.keyboard.press('Space');
  await expect(page.getByTestId('outside-clicks')).toHaveText('2');
  await expect(outside).toBeFocused();
});

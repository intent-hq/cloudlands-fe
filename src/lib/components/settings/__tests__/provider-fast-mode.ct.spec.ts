import { expect, test } from '../../../../test/ct-test';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';
import ProviderFastModeHost from './mocks/ProviderFastModeHost.svelte';

const hooksConfig = {
  mockBackend: {
    'settings.get': {
      value: {},
      origin: 'default',
      revision: 1,
      definition: {
        path: 'providers.paths',
        label: 'Paths',
        description: '',
        category: 'providers',
        type: 'object',
        defaultValue: {},
      },
    },
  },
  mockIpc: {
    [PROVIDERS_CHANNELS.GET_AVAILABILITY]: {
      success: true,
      data: { hasAnyProvider: true, providers: {}, hiddenProviders: [] },
    },
    [PROVIDERS_CHANNELS.GET_PATHS]: { success: true, data: { paths: {}, secondaryPaths: {} } },
  },
};

test('Fast mode is keyboard operable, checked, and independent for Claude and Codex', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ProviderFastModeHost, { hooksConfig });
  const codex = page.getByRole('button', { name: 'Provider actions for Codex', exact: true });
  await codex.focus();
  await page.keyboard.press('Enter');
  const item = page.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(item).toBeFocused();
  await expect(item).toHaveAccessibleDescription(
    /next turn.*Higher usage and costs.*model and account/,
  );
  await page.keyboard.press('Space');
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.evaluate((node) => {
    (node as HTMLElement).click();
    (node as HTMLElement).click();
  });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await testInfo.attach('fast-mode-checked-menu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(codex).toBeFocused();
  await page.getByRole('button', { name: 'Provider actions for Claude Code', exact: true }).click();
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Provider actions for OpenCode', exact: true }).click();
  await expect(item).toHaveCount(0);
});

test('older daemon setting omission hides Fast mode despite provider capabilities', async ({
  mount,
  page,
}) => {
  await mount(ProviderFastModeHost, { props: { supported: false }, hooksConfig });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Fast mode' })).toHaveCount(0);
});

test('a rejected save restores the checked menu value', async ({ mount, page }) => {
  await mount(ProviderFastModeHost, { props: { rejectWrites: true }, hooksConfig });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  const item = page.getByRole('menuitemcheckbox', { name: 'Fast mode' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
});

test('an open menu reflects a newer daemon preference', async ({ mount, page }) => {
  const root = await mount(ProviderFastModeHost, { hooksConfig });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  const item = page.getByRole('menuitemcheckbox', { name: 'Fast mode' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await root.update({ props: { daemonValue: false } });
  await expect(item).toHaveAttribute('aria-checked', 'false');
});

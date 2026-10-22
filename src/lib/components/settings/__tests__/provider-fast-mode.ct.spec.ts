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

test('Service Tier supports keyboard selection and keeps Claude independent', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ProviderFastModeHost, { hooksConfig });
  const codex = page.getByRole('button', { name: 'Provider actions for Codex', exact: true });
  await codex.focus();
  await page.keyboard.press('Enter');
  const tier = page.getByRole('menuitem', { name: 'Service Tier', exact: true });
  await page.keyboard.press('Home');
  await expect(tier).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const standard = page.getByRole('menuitemradio', { name: 'Standard', exact: true });
  const fast = page.getByRole('menuitemradio', { name: 'Fast', exact: true });
  await expect(standard).toBeFocused();
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await expect(standard).toHaveAttribute('aria-checked', 'false');
  await expect(fast).toHaveAccessibleDescription(
    /next turn.*Higher usage and costs.*model and account/,
  );
  await page.keyboard.press('Space');
  await expect(standard).toHaveAttribute('aria-checked', 'true');
  await expect(fast).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(fast).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await expect(standard).toHaveAttribute('aria-checked', 'false');
  await testInfo.attach('service-tier-submenu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('ArrowLeft');
  await expect(tier).toBeFocused();
  await expect(fast).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(codex).toBeFocused();
  await page.getByRole('button', { name: 'Provider actions for Claude Code', exact: true }).click();
  const claude = page.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true });
  await expect(tier).toHaveCount(0);
  await expect(claude).toHaveAttribute('aria-checked', 'false');
  await claude.click();
  await expect(claude).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Provider actions for OpenCode', exact: true }).click();
  await expect(tier).toHaveCount(0);
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
});

test('older daemon setting omission hides Service Tier despite provider capabilities', async ({
  mount,
  page,
}) => {
  await mount(ProviderFastModeHost, { props: { supported: false }, hooksConfig });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Service Tier', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitemradio')).toHaveCount(0);
});

test('a rejected save restores the selected service tier', async ({ mount, page }) => {
  const writes: unknown[] = [];
  await mount(ProviderFastModeHost, {
    props: {
      rejectWrites: true,
      onWrite: (changes) => {
        writes.push(changes);
      },
    },
    hooksConfig,
  });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Service Tier', exact: true }).click();
  const standard = page.getByRole('menuitemradio', { name: 'Standard', exact: true });
  const fast = page.getByRole('menuitemradio', { name: 'Fast', exact: true });
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await standard.click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await expect(standard).toHaveAttribute('aria-checked', 'false');
});

test('an open submenu reflects a newer daemon preference', async ({ mount, page }) => {
  const root = await mount(ProviderFastModeHost, { hooksConfig });
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Service Tier', exact: true }).click();
  const fast = page.getByRole('menuitemradio', { name: 'Fast', exact: true });
  const standard = page.getByRole('menuitemradio', { name: 'Standard', exact: true });
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await root.update({ props: { daemonValue: false } });
  await expect(fast).toHaveAttribute('aria-checked', 'false');
  await expect(standard).toHaveAttribute('aria-checked', 'true');
});

test('Ultra-fast cannot save through mouse or keyboard, while Standard and Fast persist', async ({
  mount,
  page,
}) => {
  const writes: unknown[] = [];
  await mount(ProviderFastModeHost, {
    props: {
      onWrite: (changes) => {
        writes.push(changes);
      },
    },
    hooksConfig,
  });
  const codex = page.getByRole('button', { name: 'Provider actions for Codex', exact: true });
  await codex.click();
  const tier = page.getByRole('menuitem', { name: 'Service Tier', exact: true });
  await tier.click();
  const standard = page.getByRole('menuitemradio', { name: 'Standard', exact: true });
  const fast = page.getByRole('menuitemradio', { name: 'Fast', exact: true });
  const ultra = page.getByRole('menuitemradio', { name: 'Ultra-fast', exact: true });
  await expect(ultra).toHaveAttribute('aria-checked', 'false');
  await expect(ultra).toBeDisabled();
  await expect(ultra).toHaveAccessibleDescription(/not yet supported/i);
  const box = await ultra.boundingBox();
  if (!box) throw new Error('Ultra-fast row has no hit area');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await fast.focus();
  await page.keyboard.press('ArrowDown');
  await expect(ultra).not.toBeFocused();
  await ultra.focus();
  await expect(ultra).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(ultra).toHaveAttribute('aria-checked', 'false');
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  expect(writes).toEqual([]);
  // Reselecting the active choice is a no-op, never a toggle to another tier.
  await fast.click();
  await standard.click();
  await expect(standard).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() => writes)
    .toEqual([[{ path: 'providers.fastMode', value: { codex: false, 'claude-code': false } }]]);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await codex.click();
  await tier.click();
  await expect(standard).toHaveAttribute('aria-checked', 'true');
  await standard.click();
  await fast.click();
  await expect
    .poll(() => writes)
    .toEqual([
      [{ path: 'providers.fastMode', value: { codex: false, 'claude-code': false } }],
      [{ path: 'providers.fastMode', value: { codex: true, 'claude-code': false } }],
    ]);
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await expect(standard).toHaveAttribute('aria-checked', 'false');
  await expect(ultra).toHaveAttribute('aria-checked', 'false');
});

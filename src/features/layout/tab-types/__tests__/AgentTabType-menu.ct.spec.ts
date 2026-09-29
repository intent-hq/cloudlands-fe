import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/AgentPanelMenuHarness.svelte';

test('production compact chat menu selects fonts and restores keyboard focus', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Harness, {
    hooksConfig: { mockIpc: { 'workspace:get-root': null } },
  });
  const trigger = component
    .locator('[data-panel-tabless-header]')
    .getByTestId('panel-actions-trigger');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const root = page.locator('[data-slot="menu-content"]');
  await expect(root).toBeVisible();
  await testInfo.attach('agent-root-menu', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  const fontTrigger = root.getByRole('menuitem', { name: /^Font\b/i });
  await fontTrigger.focus();
  await page.keyboard.press('ArrowRight');
  const fontMenu = page.getByRole('menu', { name: /^Font$/i });
  const mono = fontMenu.getByRole('menuitemradio', { name: 'Mono', exact: true });
  await expect(mono).toBeVisible();
  await mono.click();
  await expect(mono).toHaveAttribute('aria-checked', 'true');
  await testInfo.attach('agent-font-selection', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(fontMenu).toBeHidden();
  await expect(fontTrigger).toBeFocused();
  await expect(root).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root).toBeHidden();
  await expect(trigger).toBeFocused();
});

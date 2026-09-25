import { expect, test } from '../../../../test/ct-test';
import {
  expectDestructiveMenuInk,
  expectMenuFirstLine,
  expectMenuLabelColumn,
  menuTextGeometry,
} from '../../../../test/menu-geometry';
import Harness from './mocks/AgentPanelMenuHarness.svelte';

test('production compact chat header aligns section copy and first-line icons without indenting iconless children', async ({
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
  await root.evaluate(async (node) => {
    await document.fonts.ready;
    await Promise.allSettled(
      node.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  await expectMenuLabelColumn(root);
  for (const row of await root.locator('[data-slot="menu-command-item"]').all()) {
    await row.scrollIntoViewIfNeeded();
    await expectMenuFirstLine(row, row);
  }
  await expectDestructiveMenuInk(root.getByRole('menuitem', { name: 'Delete agent', exact: true }));
  await testInfo.attach('agent-root-first-line', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  const fontTrigger = root.getByRole('menuitem', { name: /Font style/i });
  await fontTrigger.focus();
  await page.keyboard.press('ArrowRight');
  const fontMenu = page.getByRole('menu', { name: /^Font style$/i });
  const mono = fontMenu.getByRole('menuitemradio', { name: 'Mono', exact: true });
  await expect(mono).toBeVisible();
  await expectMenuLabelColumn(fontMenu);
  expect(
    (await menuTextGeometry(fontTrigger)).left - (await menuTextGeometry(mono)).left,
  ).toBeCloseTo(24, 0);
  await mono.click();
  await expect(mono).toHaveAttribute('aria-checked', 'true');
  await expectMenuFirstLine(mono, mono);
  await testInfo.attach('agent-iconless-font-child', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(fontTrigger).toBeFocused();
  await expect(root).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

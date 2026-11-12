import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/BrowserTabTypeHeaderHarness.svelte';

test('browser owner menu is keyboard accessible and viewport follows panel resizing', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness, {
    props: {
      tabs: [
        {
          id: 'browser-one',
          type: 'browser',
          title: 'Intent docs',
          browserUrl: 'https://intentapp.dev/docs',
          ownerAgentId: 'agent-one',
          ownerAgentName: 'Browser agent',
          closable: true,
        },
      ],
      activeTabId: 'browser-one',
      renderPanelHeader: true,
      captureOwnerRequests: true,
      width: 640,
    },
  });
  const trigger = component
    .locator('[data-panel-content-header]')
    .getByRole('button', { name: 'More', exact: true });
  const headerOwner = component.getByRole('button', { name: 'Open owning agent Browser agent' });
  await headerOwner.focus();
  await expect(page.getByRole('tooltip')).toContainText('Controlled by Browser agent');
  await testInfo.attach('browser-owner-tooltip', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await headerOwner.press('Enter');
  await expect(component).toHaveAttribute(
    'data-owner-request',
    JSON.stringify([
      'workspace-1',
      { agentId: 'agent-one', sourcePanelId: 'browser-panel', openInAdjacentPanel: false },
    ]),
  );
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  await headerOwner.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await expect(component).toHaveAttribute(
    'data-owner-request',
    JSON.stringify([
      'workspace-1',
      { agentId: 'agent-one', sourcePanelId: 'browser-panel', openInAdjacentPanel: true },
    ]),
  );
  const menu = page.locator('[data-slot="menu-content"]');
  const owner = menu.getByRole('menuitem', { name: /Browser agent/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await owner.focus();
  await expect(owner).toBeFocused();
  await testInfo.attach('browser-owner-menu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  const address = component.getByRole('button', { name: 'Edit browser address' });
  await page.evaluate(() => document.fonts.ready);
  await component.screenshot({ path: testInfo.outputPath('embedded-browser-header-wide.png') });
  await address.click();
  const input = component.getByRole('textbox', { name: 'Browser address' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('https://intentapp.dev/docs');
  await input.press('Escape');

  // Chromium cannot host Electron's webview guest; measure the real viewport
  // container that supplies its bounds instead.
  const viewport = component.locator('[data-browser-device-frame-container] > div');
  const initialWidth = (await viewport.boundingBox())!.width;
  expect(initialWidth).toBeGreaterThan(0);
  await component.update({ props: { width: 360 } });
  await expect.poll(async () => (await viewport.boundingBox())!.width).toBeLessThan(initialWidth);
  expect((await viewport.boundingBox())!.width).toBe((await component.boundingBox())!.width);
  await headerOwner.focus();
  await expect(headerOwner).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Browser agent');
  const headerBox = (await component.locator('[data-panel-content-header]').boundingBox())!;
  const ownerBox = (await headerOwner.boundingBox())!;
  const actionsBox = (await component.locator('[data-panel-header-actions]').last().boundingBox())!;
  expect(ownerBox.x).toBeGreaterThanOrEqual(headerBox.x);
  expect(ownerBox.x + ownerBox.width).toBeLessThanOrEqual(actionsBox.x);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await owner.focus();
  await expect(owner).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.mouse.move(0, 0);
  await component.screenshot({ path: testInfo.outputPath('embedded-browser-header.png') });

  await component.update({
    props: {
      tabs: [
        {
          id: 'browser-one',
          type: 'browser',
          title: 'Intent docs',
          browserUrl: 'https://intentapp.dev/docs',
          closable: true,
        },
      ],
    },
  });
  await expect(headerOwner).toHaveCount(0);
});

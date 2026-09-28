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
      width: 640,
    },
  });
  const trigger = component.getByTestId('panel-actions-trigger');
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
  await trigger.focus();
  await page.keyboard.press('Enter');
  await owner.focus();
  await expect(owner).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.mouse.move(0, 0);
  await component.screenshot({ path: testInfo.outputPath('embedded-browser-header.png') });
});

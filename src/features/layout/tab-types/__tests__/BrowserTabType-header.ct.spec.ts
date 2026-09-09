import { expect, test } from '@playwright/experimental-ct-svelte';
import Harness from './mocks/BrowserTabTypeHeaderHarness.svelte';

test('browser header owns the agent chip and address hover stays transparent', async ({
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
  const header = component.locator('[data-panel-content-header]');
  const chip = header.locator('[data-browser-owner-chip]');
  const toolbar = component.locator('[data-browser-toolbar]');
  await expect(chip).toBeVisible();
  await expect(toolbar.locator('[data-browser-owner-chip]')).toHaveCount(0);
  const chipBox = await chip.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(toolbarBox!.y);

  const address = component.getByRole('button', { name: 'Edit browser address' });
  await address.hover();
  await expect(address).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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
  await expect(chip).toBeVisible();
  await page.mouse.move(0, 0);
  await component.screenshot({ path: testInfo.outputPath('embedded-browser-header.png') });
});

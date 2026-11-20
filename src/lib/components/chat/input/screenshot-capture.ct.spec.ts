import { expect, test } from '../../../../test/ct-test';
import Host from './SimpleRichInputQueueTestHost.svelte';

test('the screenshot picker attaches a removable image and preserves the draft on cancellation', async ({
  mount,
  page,
}, info) => {
  await page.evaluate(() => {
    const original = Reflect.get(window, 'electronAPI');
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 140;
    const draw = canvas.getContext('2d')!;
    draw.fillStyle = '#193049';
    draw.fillRect(0, 0, 240, 140);
    draw.fillStyle = '#8cb4d3';
    draw.fillRect(20, 20, 200, 18);
    draw.fillRect(20, 57, 120, 8);
    draw.fillRect(20, 73, 160, 8);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    Reflect.set(window, 'electronAPI', {
      ...original,
      versions: { ...original?.versions, electron: '44.0.0' },
      platform: 'darwin',
      invoke: (channel: string, request: { action: string; mode?: string }) => {
        if (channel !== 'chat-screenshot:control') return original?.invoke?.(channel, request);
        return Promise.resolve(
          request.mode === 'region'
            ? { ok: false, error: 'unavailable', detail: 'cancelled' }
            : { ok: true, value: { base64, mimeType: 'image/png' } },
        );
      },
    });
  });
  const composer = await mount(Host, { props: { chief: true, queueCount: 0, width: 560 } });
  const editor = page.locator('.tiptap-editor');
  await editor.fill('Can you take a look at this?');
  const capture = page.getByRole('button', { name: 'Take a screenshot', exact: true });
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  const attachment = page.getByRole('img', { name: 'screenshot.png', exact: true });

  const clip = { x: 0, y: 375, width: 560, height: 185 };
  await expect(capture).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('screenshot-before.png'), clip });
  await composer.update({ props: { enableScreenshotCapture: true } });
  await capture.hover();
  await expect(menu.getByRole('menuitemradio', { name: 'Full screen' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('screenshot-menu.png'), clip });
  await menu.getByRole('menuitemradio', { name: 'Region' }).click();
  await expect(menu).toBeHidden();
  await expect(attachment).toHaveCount(0);
  await expect(editor).toHaveText('Can you take a look at this?');

  const regionCapture = page.getByRole('button', { name: 'Region', exact: true });
  await expect(regionCapture).toBeEnabled();
  await regionCapture.focus();
  await regionCapture.press('ArrowUp');
  const windowMode = menu.getByRole('menuitemradio', { name: 'Window' });
  await windowMode.click();
  await expect(attachment).toBeVisible();
  await expect(editor).toHaveText('Can you take a look at this?');
  await page.screenshot({ path: info.outputPath('screenshot-attached.png'), clip });
  await page.getByRole('button', { name: 'Remove screenshot.png', exact: true }).click();
  await expect(attachment).toHaveCount(0);
});

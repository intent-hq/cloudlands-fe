import { expect, test } from '../../../../test/ct-test';
import Host from './SimpleRichInputQueueTestHost.svelte';

test('the screenshot picker opens markup and attaches the edited image to the original draft', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1120, height: 780 });
  const originalImage = await page.evaluate(() => {
    const original = Reflect.get(window, 'electronAPI');
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 420;
    const draw = canvas.getContext('2d')!;
    draw.fillStyle = '#193049';
    draw.fillRect(0, 0, canvas.width, canvas.height);
    draw.fillStyle = '#8cb4d3';
    draw.fillRect(60, 60, 600, 54);
    draw.fillRect(60, 171, 360, 24);
    draw.fillRect(60, 219, 480, 24);
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
            : {
                ok: true,
                value: {
                  base64,
                  mimeType: 'image/png',
                  width: canvas.width,
                  height: canvas.height,
                },
              },
        );
      },
    });
    return canvas.toDataURL();
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
  await expect(menu.getByRole('menuitemradio', { name: 'Region' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const windowMode = menu.getByRole('menuitemradio', { name: 'Window' });
  await windowMode.click();
  const review = page.getByRole('dialog', { name: 'Screenshot', exact: true });
  const canvas = review.getByRole('application');
  await expect(canvas).toBeVisible();
  await review.getByRole('button', { name: 'Box', exact: true }).click();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('No screenshot canvas');
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.58, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(review.getByRole('option', { name: 'Mark 1 · Box' })).toBeVisible();
  await review.getByRole('button', { name: 'Pointer', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('screenshot-markup.png') });
  await review.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(attachment).toBeVisible();
  await expect(attachment).not.toHaveAttribute('src', originalImage);
  await expect(editor).toHaveText('Can you take a look at this?');
  await page.screenshot({ path: info.outputPath('screenshot-attached.png'), clip });
  await page.getByRole('button', { name: 'Remove screenshot.png', exact: true }).click();
  await expect(attachment).toHaveCount(0);
});

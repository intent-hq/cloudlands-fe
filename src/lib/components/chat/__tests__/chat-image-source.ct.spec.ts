import { expect, test } from '../../../../test/ct-test';
import ChatImageBlock from '../ChatImageBlock.svelte';
import ToolImagePreviewHost from './ToolImagePreviewHost.svelte';

test('resolved image sources open in the lightbox and restore keyboard focus', async ({
  mount,
  page,
}, testInfo) => {
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2772df';
    context.fillRect(0, 0, 640, 360);
    return canvas.toDataURL();
  });
  const component = await mount(ChatImageBlock, {
    props: { src, mimeType: 'image/png', alt: 'desktop.png' },
  });
  const preview = component.getByRole('button', { name: 'View desktop.png full size' });
  await expect(component.getByRole('img', { name: 'desktop.png' })).toBeVisible();
  await preview.focus();
  await preview.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await testInfo.attach('image-read-lightbox.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(preview).toBeFocused();
});

test('image-read tool row preview', async ({ mount, page }, testInfo) => {
  // Browser CT cannot load Electron's workspace-file protocol. Replace only
  // that transport with deterministic pixels; keep the production tool row.
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e6eef7';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#26384e';
    ctx.fillRect(24, 24, 592, 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px sans-serif';
    ctx.fillText('Desktop image', 44, 52);
    ctx.fillStyle = '#70a3da';
    ctx.fillRect(24, 90, 170, 246);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(218, 90, 398, 246);
    ctx.fillStyle = '#26384e';
    ctx.fillText('Preview content', 248, 138);
    const fixture = canvas.toDataURL();
    const setAttribute = HTMLImageElement.prototype.setAttribute;
    HTMLImageElement.prototype.setAttribute = function (name: string, value: string) {
      if (name === 'src' && value.startsWith('workspace-file://image-read-preview/')) {
        this.dataset.workspaceSource = value;
        setAttribute.call(this, name, fixture);
      } else {
        setAttribute.call(this, name, value);
      }
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value: string) {
        if (value.startsWith('workspace-file://image-read-preview/')) {
          this.dataset.workspaceSource = value;
          descriptor.set!.call(this, fixture);
        } else {
          descriptor.set!.call(this, value);
        }
      },
    });
  });
  const component = await mount(ToolImagePreviewHost);
  const image = component.getByRole('img', { name: 'desktop.png' });
  await expect(image).toHaveCount(0);
  await expect(component.locator('[data-chat-image]')).toHaveCount(0);
  await component.getByTestId('tool-call-disclosure').click();
  await expect(image).toBeVisible();
  await expect(component.locator('[data-tool-detail-section="input"]')).toHaveCount(0);
  await expect(component.getByTestId('image-read-path')).toHaveText('/work/preview/desktop.png');
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(image).toHaveAttribute(
    'data-workspace-source',
    /workspace-file:\/\/image-read-preview\/desktop.png\?v=/,
  );
  await expect(component.getByTestId('image-file-metadata')).toContainText('desktop.png');
  await expect(component.getByTestId('image-file-metadata')).toContainText('640 × 360 px');
  await expect(component.getByTestId('image-file-metadata')).toContainText('PNG');
  const card = component.locator('[data-chat-image]');
  const summaryBox = await component.getByTestId('tool-call-summary').boundingBox();
  const cardBox = await card.boundingBox();
  expect(Math.abs(cardBox!.x - summaryBox!.x)).toBeLessThanOrEqual(1);
  const imageBox = await image.boundingBox();
  expect(imageBox!.width / imageBox!.height).toBeCloseTo(640 / 360, 1);
  await expect(component.getByTestId('tool-call-disclosure')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(() =>
      component
        .locator('[data-operational-expanded-content]')
        .evaluate((node) => node.clientHeight >= node.scrollHeight),
    )
    .toBe(true);
  await testInfo.attach('after-image-preview.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'View desktop.png full size' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await component.update({ props: { width: 320 } });
  await expect(component.getByTestId('image-file-metadata')).toContainText('640 × 360 px');
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await component.getByRole('button', { name: 'Technical details', exact: true }).click();
  await expect(component.locator('[data-tool-detail-section="input"]')).toBeVisible();
  await component.getByTestId('tool-call-disclosure').focus();
  await component.getByTestId('tool-call-disclosure').press('Enter');
  await expect(image).toHaveCount(0);
  await expect(component.locator('[data-chat-image]')).toHaveCount(0);
});

test('remote agent image paths never load from the local workspace', async ({
  mount,
}, testInfo) => {
  const component = await mount(ToolImagePreviewHost, { props: { remoteAgent: true } });
  await component.getByTestId('tool-call-disclosure').focus();
  await component.getByTestId('tool-call-disclosure').press('Enter');
  await expect(component.getByTestId('tool-call-disclosure')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(component.locator('[data-chat-image]')).toHaveCount(0);
  await expect(component.locator('[data-tool-detail-section="input"]')).toBeVisible();
  await testInfo.attach('remote-image-path-details.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});

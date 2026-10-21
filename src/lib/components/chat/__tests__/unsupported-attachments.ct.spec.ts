import { expect, test } from '../../../../test/ct-test';
import QueuedMessageAttachments from '../QueuedMessageAttachments.svelte';
import ChatMessage from '../ChatMessage.svelte';
import AttachmentPreview from '../AttachmentPreview.svelte';

for (const mimeType of ['image/svg+xml', 'image/tiff']) {
  test(`queued ${mimeType} opens its original attachment instead of a broken image`, async ({
    mount,
    page,
  }, testInfo) => {
    const opened: string[] = [];
    const component = await mount(QueuedMessageAttachments, {
      props: {
        message: { imageBlocks: [{ type: 'image', attachmentId: 'original-source', mimeType }] },
        queuedImageSrc: () => {
          throw new Error('Unsupported reference must not request a thumbnail');
        },
        openImageLightbox: () => {
          throw new Error('Unsupported reference must open the original file');
        },
        handleReferenceImageError: () => {},
        openQueuedFileAttachment: (block) => {
          opened.push(block.attachmentId);
        },
      },
    });
    const chip = component.getByTestId('queued-file-chip');
    await expect(chip).toBeVisible();
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => opened).toEqual(['original-source']);
    await expect(component.getByRole('img')).toHaveCount(0);
    await testInfo.attach('queued-file-fallback.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('sent legacy SVG is exposed as a file attachment', async ({ mount, page }, testInfo) => {
  const component = await mount(ChatMessage, {
    props: {
      message: {
        id: 'legacy-svg',
        role: 'user',
        timestamp: new Date('2026-01-01T12:00:00Z'),
        contentBlocks: [{ type: 'image', attachmentId: 'original-svg', mimeType: 'image/svg+xml' }],
      },
    },
  });
  await expect(component.getByTestId('chat-message-file-chip')).toBeVisible();
  await expect(component.getByRole('img')).toHaveCount(0);
  await expect(component.getByTestId('chat-message-image-placeholder')).toHaveCount(0);
  await testInfo.attach('sent-file-fallback.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('an old inline SVG can be downloaded unchanged from the queue', async ({
  mount,
  page,
}, testInfo) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Original diagram</text></svg>';
  await mount(QueuedMessageAttachments, {
    props: {
      message: {
        imageBlocks: [
          { type: 'image', data: Buffer.from(svg).toString('base64'), mimeType: 'image/svg+xml' },
        ],
      },
      queuedImageSrc: () => {
        throw new Error('Unsupported image must not render a thumbnail');
      },
      openImageLightbox: () => {},
      handleReferenceImageError: () => {},
      openQueuedFileAttachment: () => {},
    },
  });
  const downloadReady = page.waitForEvent('download');
  await page.getByTestId('queued-file-chip').click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe('image.svg');
  const path = testInfo.outputPath('original.svg');
  await download.saveAs(path);
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(path, 'utf8')).toBe(svg);
  await testInfo.attach('original.svg', { path, contentType: 'image/svg+xml' });
});

test('legacy JPEG aliases and MIME parameters still decode and open at full size', async ({
  mount,
  page,
}, testInfo) => {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const component = await mount(AttachmentPreview, {
    props: {
      id: 'jpeg',
      name: 'original.jpg',
      variant: 'thumbnail',
      imageData: data,
      imageMimeType: ' IMAGE/JPG; charset=utf-8 ',
    },
  });
  const image = component.getByRole('img', { name: 'original.jpg', exact: true });
  await expect(image).toBeVisible();
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(image).toHaveAttribute('src', `data:image/jpeg;base64,${data}`);
  await component.getByRole('button', { name: /view.*full size/i }).click();
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveAttribute('src', `data:image/jpeg;base64,${data}`);
  await testInfo.attach('legacy-jpeg-preview.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

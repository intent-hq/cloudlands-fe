import { expect, test } from '../../../../test/ct-test';
import QueuedMessageAttachments from '../QueuedMessageAttachments.svelte';
import ChatMessage from '../ChatMessage.svelte';
import AttachmentPreview from '../AttachmentPreview.svelte';
import UnsupportedAttachmentHydrationHost from './UnsupportedAttachmentHydrationHost.svelte';

test('two legacy file chips cannot replace an in-flight download', async ({
  mount,
  page,
}, testInfo) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Original bytes</text></svg>';
  await mount(UnsupportedAttachmentHydrationHost, {
    props: { data: Buffer.from(svg).toString('base64'), secondImage: true },
  });
  const chips = page.getByTestId('chat-message-file-chip');
  await expect(chips).toHaveCount(2);
  for (const index of [0, 1]) {
    await expect(chips.nth(index)).toBeEnabled();
    await chips.nth(index).click();
    await expect(chips.nth(index)).toBeDisabled();
    if (index === 0) await expect(chips.nth(1)).toBeDisabled();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Finish hydration' }).click();
    const download = await downloadReady;
    const path = testInfo.outputPath(`original-${index}.svg`);
    await download.saveAs(path);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path, 'utf8')).toBe(svg);
    await testInfo.attach(`original-${index}.svg`, { path, contentType: 'image/svg+xml' });
  }
  await expect(page.getByTestId('hydration-requests')).toHaveText(
    JSON.stringify([
      { agentId: 'legacy-agent', messageId: 'legacy-message', blockId: 'legacy-image' },
      { agentId: 'legacy-agent', messageId: 'legacy-message', blockId: 'second-image' },
    ]),
  );
});

for (const hasThumbnail of [false, true]) {
  test(`legacy SVG hydrates before download and retries failure (thumbnail: ${hasThumbnail})`, async ({
    mount,
    page,
  }, testInfo) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Full original</text></svg>';
    const data = Buffer.from(svg).toString('base64');
    await mount(UnsupportedAttachmentHydrationHost, {
      props: {
        data,
        thumbnail: hasThumbnail ? Buffer.from('partial preview').toString('base64') : undefined,
      },
    });
    const chip = page.getByTestId('chat-message-file-chip');
    const requests = page.getByTestId('hydration-requests');
    await expect(chip).toBeEnabled();
    await expect(chip).not.toHaveAttribute('href');
    await chip.click();
    await expect(chip).toBeDisabled();
    await expect(requests).toHaveText(
      JSON.stringify([
        { agentId: 'legacy-agent', messageId: 'legacy-message', blockId: 'legacy-image' },
      ]),
    );
    await page.getByRole('button', { name: 'Fail hydration' }).click();
    await expect(chip).toBeEnabled();
    await expect(chip).not.toHaveAttribute('href');
    await chip.click();
    await expect(chip).toBeDisabled();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Finish hydration' }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('original.svg');
    const path = testInfo.outputPath('hydrated-original.svg');
    await download.saveAs(path);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path, 'utf8')).toBe(svg);
    await expect(chip).toHaveAttribute('href', `data:application/octet-stream;base64,${data}`);
    await expect(chip).toContainText('original.svg');
    await expect(page.getByRole('img')).toHaveCount(0);
    await testInfo.attach('hydrated-original.svg', { path, contentType: 'image/svg+xml' });
    await testInfo.attach('hydrated-file-chip.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

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

import { expect, test } from '../../../../test/ct-test';
import type { QueuedMessage } from '$shared/types';
import QueuedMessageImagesHost from './QueuedMessageImagesHost.svelte';

const reference = (attachmentId: string) => ({ type: 'image' as const, attachmentId });
const queued = (
  id: string,
  imageBlocks: NonNullable<QueuedMessage['imageBlocks']> = [],
  content = id,
) => ({
  id,
  content,
  queuedAt: '2026-10-05T12:00:00Z',
  position: 0,
  messageMetadata: { fromPrincipalId: 'image-author' },
  imageBlocks,
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // CT replaces Electron's image-byte transport, preserving reference resolution.
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    const setAttribute = HTMLImageElement.prototype.setAttribute;
    const source = (image: HTMLImageElement, value: string) => {
      if (!value.startsWith('workspace-file://queue-images/')) return value;
      image.dataset.workspaceSource = value;
      const id = value.split('/').at(-1)!.replace('.png', '');
      if (document.documentElement.dataset.queueImageFailure === id)
        return 'data:image/png;base64,broken';
      const size = id === 'first' ? 32 : id === 'second' ? 48 : 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d')!;
      context.fillStyle = id === 'first' ? '#487bb5' : id === 'second' ? '#d49b35' : '#59a581';
      context.fillRect(0, 0, size, size);
      context.fillStyle = '#ffffff';
      context.font = `${size / 2}px sans-serif`;
      context.fillText(id === 'first' ? '1' : id === 'second' ? '2' : '3', size / 4, size * 0.7);
      return canvas.toDataURL();
    };
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...original,
      set(value: string) {
        original.set!.call(this, source(this, value));
      },
    });
    HTMLImageElement.prototype.setAttribute = function (name: string, value: string) {
      setAttribute.call(this, name, name === 'src' ? source(this, value) : value);
    };
  });
});

test('later merged image attachments load and keep their lightbox identity through edit and send', async ({
  mount,
  page,
}, info) => {
  const first = queued('merged', [reference('first')], 'First queued message');
  const component = await mount(QueuedMessageImagesHost, { props: { messages: [first] } });
  const row = component.getByTestId('queued-message-row');
  const images = row.getByTestId('queued-image-thumbnail').locator('img');
  await expect
    .poll(() => images.first().evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(32);
  const second = {
    ...first,
    content: `${first.content}\n\nSecond queued message`,
    imageBlocks: [...first.imageBlocks, reference('second'), reference('third')],
  };
  await component.update({ props: { messages: [second] } });
  await expect(row).toHaveCount(1);
  await expect(images).toHaveCount(3);
  await expect
    .poll(() =>
      images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth)),
    )
    .toEqual([32, 48, 64]);
  const third = {
    ...second,
    content: `${second.content}\n\nThird queued message`,
    imageBlocks: [...second.imageBlocks, reference('fourth')],
  };
  await component.update({ props: { messages: [third] } });
  await expect(images).toHaveCount(4);
  await expect
    .poll(() => images.last().evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(64);
  const thumbnail = row.getByTestId('queued-image-thumbnail').nth(1);
  await thumbnail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Image preview' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(48);
  await info.attach('later-image-lightbox.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(thumbnail).toBeFocused();
  await row.getByTestId('queued-message-content').press('F2');
  await row.getByRole('textbox').fill('Edited queued messages');
  await row.getByRole('textbox').press('Enter');
  await expect
    .poll(() =>
      images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth)),
    )
    .toEqual([32, 48, 64, 64]);
  await info.attach('merged-queue-images.png', {
    body: await row.screenshot(),
    contentType: 'image/png',
  });
  await row.getByTestId('queued-message-content').press('Control+Enter');
  await expect(row).toHaveCount(0);
  const sent = JSON.parse((await component.getByTestId('sent-images').textContent())!);
  expect(sent.imageBlocks.map((block: { attachmentId: string }) => block.attachmentId)).toEqual([
    'first',
    'second',
    'third',
    'fourth',
  ]);
});

test('separate later image-only messages survive disclosure and removal of an earlier row', async ({
  mount,
}, info) => {
  const component = await mount(QueuedMessageImagesHost, {
    props: {
      messages: [
        queued('text-only'),
        queued('second-row', [reference('second')], ''),
        queued('third-row', [reference('third'), reference('fourth')], ''),
      ],
    },
  });
  const images = component.getByTestId('queued-image-thumbnail').locator('img');
  await expect
    .poll(() =>
      images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth)),
    )
    .toEqual([48, 64, 64]);
  const disclosure = component.getByTestId('queued-messages-disclosure');
  await disclosure.click();
  await expect(images).toHaveCount(0);
  await disclosure.click();
  await expect
    .poll(() =>
      images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth)),
    )
    .toEqual([48, 64, 64]);
  await component
    .getByTestId('queued-message-row')
    .first()
    .getByTestId('queued-message-content')
    .press('Delete');
  await expect(component.getByTestId('queued-message-row')).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth)),
    )
    .toEqual([48, 64, 64]);
  await info.attach('later-image-only-messages.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});

for (const failure of ['lookup', 'image'] as const) {
  test(`later queued images recover after a ${failure} failure and backend reconnect`, async ({
    mount,
    page,
  }, info) => {
    if (failure === 'image')
      await page.evaluate(() => {
        document.documentElement.dataset.queueImageFailure = 'second';
      });
    const component = await mount(QueuedMessageImagesHost, {
      props: {
        messages: [
          queued('merged', [reference('first'), reference('second'), reference('missing')]),
        ],
        lookupFails: failure === 'lookup',
      },
    });
    const thumbnails = component.getByTestId('queued-image-thumbnail');
    await expect
      .poll(() =>
        thumbnails
          .first()
          .locator('img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(32);
    await expect(thumbnails.nth(1).getByTestId('queued-image-placeholder')).toBeVisible();
    await expect(thumbnails.nth(2).getByTestId('queued-image-placeholder')).toBeVisible();
    await info.attach(`before-${failure}-reconnect.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => {
      delete document.documentElement.dataset.queueImageFailure;
    });
    await component.getByRole('button', { name: 'Reconnect backend', exact: true }).click();
    await expect
      .poll(() =>
        thumbnails
          .nth(1)
          .locator('img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(48);
    await expect(thumbnails.nth(2).getByTestId('queued-image-placeholder')).toBeVisible();
    const requests = JSON.parse((await component.getByTestId('image-requests').textContent())!);
    expect(
      requests.filter((request: { attachmentId: string }) => request.attachmentId === 'second'),
    ).toHaveLength(2);
    expect(
      requests.every((request: { workspaceId: string }) => request.workspaceId === 'queue-images'),
    ).toBe(true);
    await info.attach(`after-${failure}-reconnect.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await info.attach('image-request-log.json', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    });
  });
}

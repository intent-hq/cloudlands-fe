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

type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['getByTestId']>;

async function queueScreenshot(component: Locator) {
  const queue = component.getByTestId('queued-messages-container');
  if (!(await queue.count())) return component.screenshot();
  const showAll = queue.getByRole('button', { name: 'Show all queued messages', exact: true });
  if (await showAll.count()) await showAll.click();
  return queue.screenshot();
}

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
      context.fillStyle =
        id === 'first'
          ? '#487bb5'
          : id === 'second'
            ? '#d49b35'
            : id === 'fourth'
              ? '#9359a5'
              : '#59a581';
      context.fillRect(0, 0, size, size);
      context.fillStyle = '#ffffff';
      context.font = `${size / 2}px sans-serif`;
      context.fillText(
        id === 'first' ? '1' : id === 'second' ? '2' : id === 'fourth' ? '4' : '3',
        size / 4,
        size * 0.7,
      );
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

test('pending image groups survive out-of-order ACKs, confirmation, editing, removal and sending', async ({
  mount,
  page,
}, info) => {
  const component = await mount(QueuedMessageImagesHost, {
    props: { messages: [], projectSubmissions: true },
  });
  const rows = component.getByTestId('queued-message-row');
  const capture = async (name: string) =>
    info.attach(name + '.png', {
      body: await queueScreenshot(component),
      contentType: 'image/png',
    });
  const texts = async () =>
    (await rows.getByTestId('queued-message-text').allTextContents()).map((text) => text.trim());
  const widths = () =>
    rows
      .getByTestId('queued-image-thumbnail')
      .locator('img')
      .evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth));
  await component.getByRole('button', { name: 'Queue text', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await capture('initial-text-only');
  await component.getByRole('button', { name: 'Confirm queue', exact: true }).click();
  await component.getByRole('button', { name: 'Queue second image', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect.poll(widths).toEqual([48]);
  await expect(rows.first().getByTestId('queued-image-thumbnail')).toHaveCount(0);
  await capture('second-image-optimistic');
  await component.getByRole('button', { name: 'Queue multiple images', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await expect(rows.nth(1).getByTestId('queued-image-thumbnail')).toHaveCount(1);
  await expect(rows.nth(2).getByTestId('queued-image-thumbnail')).toHaveCount(2);
  await capture('third-multiple-images-optimistic');
  await component.getByRole('button', { name: 'Acknowledge last', exact: true }).click();
  await expect
    .poll(texts)
    .toEqual(['First text message', 'Second image message', 'Third multiple-image message']);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await expect(rows.nth(2).getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(rows.first().getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await capture('out-of-order-ack');
  await component.getByRole('button', { name: 'Acknowledge second', exact: true }).click();
  await expect
    .poll(texts)
    .toEqual(['First text message', 'Second image message', 'Third multiple-image message']);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await capture('both-image-acks');
  await component.getByRole('button', { name: 'Confirm queue', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await capture('confirmed-image-groups');
  const disclosure = component.getByTestId('queued-messages-disclosure');
  await disclosure.click();
  await expect(rows).toHaveCount(0);
  await capture('collapsed-image-groups');
  await disclosure.click();
  await expect.poll(widths).toEqual([48, 64, 64]);
  await capture('expanded-image-groups');
  const thumbnail = rows.nth(2).getByTestId('queued-image-thumbnail').first();
  await thumbnail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Image preview' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(64);
  await info.attach('third-message-lightbox.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(thumbnail).toBeFocused();
  await rows.nth(1).getByTestId('queued-message-content').press('F2');
  await rows.nth(1).getByRole('textbox').fill('Edited second message');
  await rows.nth(1).getByRole('textbox').press('Enter');
  await expect
    .poll(texts)
    .toEqual(['First text message', 'Edited second message', 'Third multiple-image message']);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await capture('edited-second-image-group');
  await rows.first().getByTestId('queued-message-content').press('Delete');
  await expect(rows).toHaveCount(2);
  await expect.poll(widths).toEqual([48, 64, 64]);
  await capture('removed-text-group');
  await rows.first().getByTestId('queued-message-content').press('Control+Enter');
  await expect(rows).toHaveCount(1);
  await expect.poll(widths).toEqual([64, 64]);
  const sent = JSON.parse((await component.getByTestId('sent-images').textContent())!);
  expect(sent.content).toBe('Edited second message');
  expect(sent.imageBlocks.map((block: { attachmentId: string }) => block.attachmentId)).toEqual([
    'second',
  ]);
  await capture('sent-second-image-group');
  await info.attach('queue-projection.json', {
    body: (await component.getByTestId('queue-projection').textContent())!,
    contentType: 'application/json',
  });
});

for (const first of ['image only', 'file'] as const) {
  for (const confirmed of [false, true]) {
    test(
      (confirmed ? 'confirmed ' : 'optimistic ') +
        first +
        ' stays separate from following text and image submissions',
      async ({ mount }, info) => {
        const component = await mount(QueuedMessageImagesHost, {
          props: { messages: [], projectSubmissions: true },
        });
        const rows = component.getByTestId('queued-message-row');
        await component
          .getByRole('button', {
            name: first === 'file' ? 'Queue file' : 'Queue image only',
            exact: true,
          })
          .click();
        await expect(rows).toHaveCount(1);
        if (confirmed)
          await component.getByRole('button', { name: 'Confirm queue', exact: true }).click();
        await component.getByRole('button', { name: 'Queue text', exact: true }).click();
        await component.getByRole('button', { name: 'Queue text', exact: true }).click();
        await expect(rows).toHaveCount(2);
        await expect(rows.last().getByTestId('queued-message-text')).toHaveText(
          'First text message\n\nFirst text message',
        );
        await component.getByRole('button', { name: 'Queue second image', exact: true }).click();
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(1).getByTestId('queued-image-thumbnail')).toHaveCount(0);
        if (first === 'file')
          await expect(rows.first().getByTestId('queued-file-chip')).toHaveText('notes.txt');
        else
          await expect
            .poll(() =>
              rows
                .first()
                .getByTestId('queued-image-thumbnail')
                .locator('img')
                .evaluate((image: HTMLImageElement) => image.naturalWidth),
            )
            .toBe(32);
        await info.attach(
          (confirmed ? 'confirmed-' : 'optimistic-') +
            first.replace(' ', '-') +
            '-with-text-and-images.png',
          { body: await queueScreenshot(component), contentType: 'image/png' },
        );
      },
    );
  }
}

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
  await info.attach('collapsed-image-only.png', {
    body: await queueScreenshot(component),
    contentType: 'image/png',
  });
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
    body: await queueScreenshot(component),
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
      body: await queueScreenshot(component),
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
      body: await queueScreenshot(component),
      contentType: 'image/png',
    });
    await info.attach('image-request-log.json', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    });
  });
}

const groupedRetry = () => ({
  ...queued(
    'retry-parent',
    [reference('second'), reference('third')],
    'Text before images\n\nMultiple images',
  ),
  requeuedAfterFailure: true,
  deliveryGroups: [
    { content: 'Text before images' },
    { content: '', imageBlocks: [reference('first')] },
    {
      content: 'Multiple images',
      imageBlocks: [reference('second'), reference('third')],
      fileBlocks: [{ type: 'file' as const, attachmentId: 'document', fileName: 'notes.txt' }],
    },
  ],
});

test('a retry displays ordered groups with parent controls and edits the full parent content', async ({
  mount,
  page,
}, info) => {
  const retry = groupedRetry();
  const component = await mount(QueuedMessageImagesHost, { props: { messages: [retry] } });
  const row = component.getByTestId('queued-message-row');
  const groups = row.getByTestId('queued-message-delivery-group');
  const widths = () =>
    row
      .getByTestId('queued-image-thumbnail')
      .locator('img')
      .evaluateAll((nodes: HTMLImageElement[]) => nodes.map((image) => image.naturalWidth));
  await expect(row).toHaveCount(1);
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0).getByTestId('queued-message-text')).toHaveText('Text before images');
  await expect(groups.nth(0).getByTestId('queued-image-thumbnail')).toHaveCount(0);
  await expect(groups.nth(1).getByTestId('queued-message-text')).toHaveText('');
  await expect(groups.nth(1).getByTestId('queued-image-thumbnail')).toHaveCount(1);
  await expect(groups.nth(2).getByTestId('queued-message-text')).toHaveText('Multiple images');
  await expect(groups.nth(2).getByTestId('queued-image-thumbnail')).toHaveCount(2);
  await expect(groups.nth(2).getByTestId('queued-file-chip')).toHaveText('notes.txt');
  await expect.poll(widths).toEqual([32, 48, 64]);
  await expect(row.getByTestId('queued-message-actions')).toHaveCount(1);
  await expect(groups.getByTestId('queued-message-actions')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
  await info.attach('retry-ordered-groups.png', {
    body: await queueScreenshot(component),
    contentType: 'image/png',
  });
  const thumbnail = groups.nth(1).getByTestId('queued-image-thumbnail');
  await thumbnail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Image preview' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(32);
  await info.attach('retry-carry-over-lightbox.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(thumbnail).toBeFocused();
  await row.getByTestId('queued-message-content').first().press('F2');
  await expect(row.getByRole('textbox')).toHaveValue(retry.content);
  await info.attach('retry-parent-full-editor.png', {
    body: await queueScreenshot(component),
    contentType: 'image/png',
  });
  await row.getByRole('textbox').press('Escape');
  await expect(groups).toHaveCount(3);
  await expect.poll(widths).toEqual([32, 48, 64]);
  await row.getByTestId('queued-message-content').first().press('F2');
  await row.getByRole('textbox').press('Enter');
  await expect(groups).toHaveCount(3);
  await row.getByTestId('queued-message-content').first().press('F2');
  await row.getByRole('textbox').fill('Replacement retry message');
  await row.getByRole('textbox').press('Enter');
  await expect(groups).toHaveCount(0);
  await expect(row.getByTestId('queued-message-text')).toHaveText('Replacement retry message');
  await expect.poll(widths).toEqual([32, 48, 64]);
  await info.attach('retry-replacement-single-message.png', {
    body: await queueScreenshot(component),
    contentType: 'image/png',
  });
  await row.getByTestId('queued-message-content').press('Control+Enter');
  await expect(row).toHaveCount(0);
  const sent = JSON.parse((await component.getByTestId('sent-images').textContent())!);
  expect(sent.id).toBe('retry-parent');
  expect(sent.deliveryGroups).toBeUndefined();
  expect(sent.imageBlocks.map((block: { attachmentId: string }) => block.attachmentId)).toEqual([
    'first',
    'second',
    'third',
  ]);
  await info.attach('retry-parent-sent.json', {
    body: JSON.stringify(sent, null, 2),
    contentType: 'application/json',
  });
});

for (const failure of ['lookup', 'image'] as const) {
  test(
    'retry group images recover from ' + failure + ' failure without changing parent groups',
    async ({ mount, page }, info) => {
      if (failure === 'image')
        await page.evaluate(() => {
          document.documentElement.dataset.queueImageFailure = 'second';
        });
      const retry = {
        ...groupedRetry(),
        imageBlocks: [],
        deliveryGroups: [
          { content: 'Text before images' },
          { content: '', imageBlocks: [reference('first')] },
          {
            content: 'Recovering and missing images',
            imageBlocks: [reference('second'), reference('missing')],
          },
        ],
      };
      const component = await mount(QueuedMessageImagesHost, {
        props: { messages: [retry], lookupFails: failure === 'lookup' },
      });
      const row = component.getByTestId('queued-message-row');
      const groups = row.getByTestId('queued-message-delivery-group');
      await expect(groups).toHaveCount(3);
      const thumbnails = row.getByTestId('queued-image-thumbnail');
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
      await info.attach('retry-before-' + failure + '-recovery.png', {
        body: await queueScreenshot(component),
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
      await expect(groups).toHaveCount(3);
      await info.attach('retry-after-' + failure + '-recovery.png', {
        body: await queueScreenshot(component),
        contentType: 'image/png',
      });
      await info.attach('retry-group-request-log.json', {
        body: (await component.getByTestId('image-requests').textContent())!,
        contentType: 'application/json',
      });
      await row.getByTestId('queued-message-content').first().press('Delete');
      await expect(row).toHaveCount(0);
      await info.attach('retry-parent-removed.png', {
        body: await queueScreenshot(component),
        contentType: 'image/png',
      });
    },
  );
}

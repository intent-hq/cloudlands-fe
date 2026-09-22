import { readFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import MarkdownViewer from '../MarkdownViewer.svelte';
import ChatImageBlock from '../../chat/ChatImageBlock.svelte';
import ImageLightbox from '../../ui/ImageLightbox.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;
type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" rx="16" fill="#e8edf4"/><circle cx="120" cy="120" r="64" fill="#657ca8"/><path d="M240 152l48-64 72 64" fill="none" stroke="#657ca8" stroke-width="12"/></svg>';
const imageData = Buffer.from(svg).toString('base64');
const imageSource = `data:image/svg+xml;base64,${imageData}`;
const thumbnailSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#ff0000"/></svg>';

interface CapturedImage {
  types: string[];
  mimeType: string;
  bytes: number[];
  width: number;
  height: number;
  foreground: number[];
  background: number[];
}

type ClipboardTestWindow = Window & {
  imageCopyTest: { writes: CapturedImage[]; keys: KeyboardEvent[] };
};

async function captureImageClipboard(page: Page) {
  await page.evaluate(() => {
    const capture = { writes: [] as CapturedImage[], keys: [] as KeyboardEvent[] };
    (window as ClipboardTestWindow).imageCopyTest = capture;
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        for (const item of items) {
          const blob = await item.getType('image/png');
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          capture.writes.push({
            types: [...item.types],
            mimeType: blob.type,
            bytes: [...new Uint8Array(await blob.arrayBuffer())],
            width: bitmap.width,
            height: bitmap.height,
            foreground: [...context.getImageData(120, 120, 1, 1).data],
            background: [...context.getImageData(400, 120, 1, 1).data],
          });
          bitmap.close();
        }
      },
    });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key.toLowerCase() === 'c' && (event.metaKey || event.ctrlKey)) {
          capture.keys.push(event);
        }
      },
      true,
    );
    // Negative cases must reach native copy without replacing the user's clipboard.
    // Synthetic ClipboardEvents are safe and retain their production cancellation state.
    window.addEventListener('copy', (event) => {
      if (event.isTrusted) event.preventDefault();
    });
  });
}

async function expectCopiedImage(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => (window as ClipboardTestWindow).imageCopyTest.writes.length))
    .toBe(count);
  const copied = await page.evaluate(() =>
    (window as ClipboardTestWindow).imageCopyTest.writes.at(-1)!,
  );
  expect(copied.types).toEqual(['image/png']);
  expect(copied.mimeType).toBe('image/png');
  expect(copied.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([copied.width, copied.height]).toEqual([480, 240]);
  expect(copied.foreground).toEqual([101, 124, 168, 255]);
  expect(copied.background).toEqual([232, 237, 244, 255]);
  return Buffer.from(copied.bytes);
}

async function dispatchCopy(target: Locator) {
  return target.evaluate(
    (node) => !node.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true })),
  );
}

async function expectIgnoredShortcut(page: Page, shortcut: string) {
  await page.keyboard.press(shortcut);
  expect(
    await page.evaluate(
      () => (window as ClipboardTestWindow).imageCopyTest.keys.at(-1)?.defaultPrevented,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as ClipboardTestWindow).imageCopyTest.writes.length),
  ).toBe(0);
}

function expectSameBox(actual: Box, expected: Box) {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(1);
  }
}

for (const isStreaming of [false, true]) {
  test(`${isStreaming ? 'streaming' : 'static'} image actions have equal insets and stay usable on hover`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${src})\n\nAfter the image.`, isStreaming },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await image.evaluate((node: HTMLImageElement) => node.decode());
    const trigger = component.getByRole('button', { name: /image options/i });
    await expect(trigger).toHaveCount(0);
    await image.hover();
    await expect(trigger).toBeVisible();
    const imageBox = (await image.boundingBox())!;
    const triggerBox = (await trigger.boundingBox())!;
    const insets = {
      top: triggerBox.y - imageBox.y,
      right: imageBox.x + imageBox.width - triggerBox.x - triggerBox.width,
    };
    await testInfo.attach('image-action-insets', {
      body: JSON.stringify(insets),
      contentType: 'application/json',
    });
    expect(insets.top).toBeCloseTo(6, 0);
    expect(insets.right).toBeCloseTo(insets.top, 0);

    await page.clock.install();
    await page.clock.fastForward(10_000);
    await expect(trigger).toBeVisible();
    await page.clock.resume();
    await component.getByText('After the image.', { exact: true }).hover();
    await expect(trigger).toHaveCount(0);
    await image.hover();
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /copy image/i }).hover();
    await expect(trigger).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test(`${isStreaming ? 'streaming' : 'static'} right-click menu preserves preview and focus behavior`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${src})`, isStreaming },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await image.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /download/i })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(component.getByRole('button', { name: /image options/i })).toBeFocused();
    await image.click();
    const dialog = page.getByRole('dialog', { name: /image preview/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('img').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /copy image/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /image options/i })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(image).toBeFocused();
  });

  test(`${isStreaming ? 'streaming' : 'static'} focused image copies PNG with Cmd+C, Ctrl+C and copy events`, async ({
    mount,
    page,
  }, testInfo) => {
    await captureImageClipboard(page);
    const otherSource = `data:image/svg+xml;base64,${Buffer.from(thumbnailSvg).toString('base64')}`;
    const component = await mount(MarkdownViewer, {
      props: {
        content: `![diagram](${imageSource})\n\n![other image](${otherSource})`,
        isStreaming,
      },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await image.evaluate((node: HTMLImageElement) => node.decode());
    await page.keyboard.press('Tab');
    await expect(image).toBeFocused();
    await page.keyboard.press('Meta+c');
    await expectCopiedImage(page, 1);

    // Moving the pointer must not replace the keyboard's focused copy target.
    await component.getByRole('button', { name: 'other image', exact: true }).hover();
    await expect(image).toBeFocused();
    await page.keyboard.press('Control+c');
    await expectCopiedImage(page, 2);
    expect(await dispatchCopy(image)).toBe(true);
    const png = await expectCopiedImage(page, 3);
    await testInfo.attach('focused-image-clipboard.png', { body: png, contentType: 'image/png' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test(`${isStreaming ? 'streaming' : 'static'} image options and portalled menu copy the image`, async ({
    mount,
    page,
  }) => {
    await captureImageClipboard(page);
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${imageSource})`, isStreaming },
    });
    await component.getByRole('button', { name: 'diagram', exact: true }).focus();
    const trigger = component.getByRole('button', { name: /image options/i });
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Meta+c');
    await expectCopiedImage(page, 1);
    expect(await dispatchCopy(trigger)).toBe(true);
    await expectCopiedImage(page, 2);

    await page.keyboard.press('ArrowDown');
    const download = page.getByRole('menuitem', { name: /download/i });
    await expect(download).toBeFocused();
    await expect(component.getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('Control+c');
    await expectCopiedImage(page, 3);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(download).toBeFocused();
    expect(await dispatchCopy(download)).toBe(true);
    await expectCopiedImage(page, 4);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test(`${isStreaming ? 'streaming' : 'static'} reserved image frame survives loading, copying and right-click preview`, async ({
    mount,
    page,
  }, testInfo) => {
    await captureImageClipboard(page);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const src = 'https://image.test/reserved-original';
    let releaseImage!: () => void;
    const imageReady = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route(src, async (route) => {
      await imageReady;
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    try {
      const component = await mount(MarkdownViewer, {
        props: {
          content: `![diagram](${src})\n\nAfter the image.`,
          isStreaming,
          media: { [src]: { width: 480, height: 240 } },
        },
      });
      const image = component.getByRole('button', { name: 'diagram', exact: true });
      const frame = component.locator('[data-loaded]');
      const after = component.getByText('After the image.', { exact: true });
      await expect(frame).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(image).toHaveJSProperty('naturalWidth', 0);
      const before = (await frame.boundingBox())!;
      const afterTextBefore = (await after.boundingBox())!;
      expect(before.width).toBeGreaterThan(0);
      expect(before.width).toBeLessThan(480);
      expect(Math.abs(before.height - before.width / 2)).toBeLessThanOrEqual(1);

      releaseImage();
      await image.evaluate((node: HTMLImageElement) => node.decode());
      await expect(image).toHaveCSS('opacity', '1');
      expectSameBox((await frame.boundingBox())!, before);
      expectSameBox((await image.boundingBox())!, before);
      expectSameBox((await after.boundingBox())!, afterTextBefore);

      await image.focus();
      await page.keyboard.press('Meta+c');
      await expectCopiedImage(page, 1);
      const trigger = component.getByRole('button', { name: /image options/i });
      const triggerBox = (await trigger.boundingBox())!;
      expect(triggerBox.y - before.y).toBeCloseTo(6, 0);
      expect(before.x + before.width - triggerBox.x - triggerBox.width).toBeCloseTo(6, 0);
      await image.click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await testInfo.attach('reserved-image-controls.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.getByRole('menuitem', { name: /copy image/i }).click();
      await expectCopiedImage(page, 2);
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Control+c');
      const png = await expectCopiedImage(page, 3);

      await image.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: /image preview/i })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(image).toBeFocused();
      const final = (await frame.boundingBox())!;
      expectSameBox(final, before);
      expectSameBox((await after.boundingBox())!, afterTextBefore);
      await testInfo.attach('reserved-image-geometry', {
        body: JSON.stringify({
          before,
          final,
          afterTextBefore,
          afterTextFinal: await after.boundingBox(),
        }),
        contentType: 'application/json',
      });
      await testInfo.attach('reserved-image-clipboard.png', {
        body: png,
        contentType: 'image/png',
      });
    } finally {
      releaseImage();
    }
  });
}

test('chat image fills its tile with equal action insets', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatImageBlock, {
    props: {
      data: Buffer.from(svg).toString('base64'),
      mimeType: 'image/svg+xml',
      alt: 'diagram',
    },
  });
  const image = component.getByRole('img');
  await image.evaluate((node: HTMLImageElement) => node.decode());
  const tile = component.getByRole('button', { name: /view.*full size/i });
  const trigger = component.getByRole('button', { name: /image options/i });
  await expect(trigger).toHaveCSS('opacity', '0');
  await image.hover();
  await expect(trigger).toHaveCSS('opacity', '1');
  const tileBox = (await tile.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;
  expect(Math.abs(imageBox.height - (tileBox.height - 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(imageBox.y - (tileBox.y + 1))).toBeLessThanOrEqual(1);
  expect(triggerBox.y - tileBox.y).toBeCloseTo(6, 0);
  expect(tileBox.x + tileBox.width - triggerBox.x - triggerBox.width).toBeCloseTo(6, 0);
  await page.mouse.move(0, 0);
  await expect(trigger).toHaveCSS('opacity', '0');
  await tile.focus();
  await expect(trigger).toHaveCSS('opacity', '1');
  await image.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /copy image/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const source of ['https', 'data'] as const) {
  test(`keyboard preview and original download for ${source} images`, async ({
    mount,
    page,
  }, testInfo) => {
    const src =
      source === 'https'
        ? 'https://image.test/original'
        : `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.route('https://image.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${src})` },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await expect(image).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(image).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /image preview/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'diagram', exact: true })).toHaveAttribute(
      'src',
      src,
    );
    await dialog.getByRole('button', { name: /close preview/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(image).toBeFocused();
    await page.keyboard.press('Tab');
    const trigger = component.getByRole('button', { name: /image options/i });
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
    const screenshotPath = testInfo.outputPath('image-actions.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('image-actions', { path: screenshotPath, contentType: 'image/png' });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /download/i }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('diagram.svg');
    expect(await readFile((await download.path())!, 'utf8')).toBe(svg);
    await expect(trigger).toBeFocused();
  });
}

test('active full-size preview and its portalled menu copy the original HTTPS image', async ({
  mount,
  page,
}, testInfo) => {
  await captureImageClipboard(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://image.test/original', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg,
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  const component = await mount(MarkdownViewer, {
    props: { content: '![diagram](https://image.test/original)' },
  });
  const image = component.getByRole('button', { name: 'diagram', exact: true });
  await image.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  const close = dialog.getByRole('button', { name: /close preview/i });
  await expect(close).toBeFocused();
  await page.keyboard.press('Meta+c');
  await expectCopiedImage(page, 1);
  expect(await dispatchCopy(close)).toBe(true);
  await expectCopiedImage(page, 2);
  await expect(dialog).toBeVisible();

  const trigger = dialog.getByRole('button', { name: /image options/i });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /download/i })).toBeFocused();
  await expect(dialog.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Control+c');
  const png = await expectCopiedImage(page, 3);
  await testInfo.attach('preview-clipboard.png', { body: png, contentType: 'image/png' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
});

for (const format of ['SVG', 'PNG'] as const) {
  test(`menu Copy image and Cmd+C preserve ${format} source pixels`, async ({ mount, page }) => {
    await captureImageClipboard(page);
    const source =
      format === 'SVG'
        ? imageSource
        : await page.evaluate(async (svgSource) => {
            const image = new Image();
            image.src = svgSource;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            canvas.getContext('2d')!.drawImage(image, 0, 0);
            return canvas.toDataURL('image/png');
          }, imageSource);
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${source})` },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await image.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /copy image/i }).click();
    await expectCopiedImage(page, 1);
    await image.focus();
    await page.keyboard.press('Meta+c');
    await expectCopiedImage(page, 2);
  });
}

test('selected Markdown text takes precedence over focused image copying', async ({
  mount,
  page,
}) => {
  await captureImageClipboard(page);
  const component = await mount(MarkdownViewer, {
    props: { content: `![diagram](${imageSource})\n\nCopy this text instead.` },
  });
  const image = component.getByRole('button', { name: 'diagram', exact: true });
  await image.focus();
  await component.getByText('Copy this text instead.', { exact: true }).evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(image).toBeFocused();
  await expectIgnoredShortcut(page, 'Meta+c');
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(image)).toBe(false);
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    'Copy this text instead.',
  );
});

test('hover-only image actions do not hijack copying from an unrelated focused link', async ({
  mount,
  page,
}) => {
  await captureImageClipboard(page);
  const component = await mount(MarkdownViewer, {
    props: { content: `![diagram](${imageSource})\n\n[Elsewhere](https://image.test/elsewhere)` },
  });
  const link = component.getByRole('link', { name: 'Elsewhere' });
  await link.focus();
  await component.getByRole('button', { name: 'diagram', exact: true }).hover();
  await expect(component.getByRole('button', { name: /image options/i })).toBeVisible();
  await expect(link).toBeFocused();
  await expectIgnoredShortcut(page, 'Meta+c');
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(link)).toBe(false);
});

test('editable descendants in an active preview retain their own copy behavior', async ({
  mount,
  page,
}) => {
  await captureImageClipboard(page);
  await mount(ImageLightbox, {
    props: { open: true, imageUrl: imageSource, showActionsMenu: true },
  });
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  await expect(dialog).toBeVisible();
  // Real editable DOM under the production event boundary exercises the guard,
  // without changing production UI or relying on sanitized Markdown form markup.
  await dialog.evaluate((node) => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Preview input');
    input.value = 'Input text';
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.setAttribute('aria-label', 'Preview editor');
    editable.setAttribute('role', 'textbox');
    editable.textContent = 'Editable text';
    node.append(input, editable);
  });
  const input = dialog.getByRole('textbox', { name: 'Preview input' });
  await input.focus();
  await input.evaluate((node: HTMLInputElement) => node.select());
  await expectIgnoredShortcut(page, 'Meta+c');
  expect(await dispatchCopy(input)).toBe(false);
  await expect(input).toHaveValue('Input text');

  const editable = dialog.getByRole('textbox', { name: 'Preview editor' });
  await editable.focus();
  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(editable)).toBe(false);
  await expect(editable).toHaveText('Editable text');
});

test('unsupported preview sources do not intercept image copy shortcuts', async ({
  mount,
  page,
}) => {
  await captureImageClipboard(page);
  await page.route('http://image.test/unsupported', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }),
  );
  await mount(ImageLightbox, {
    props: { open: true, imageUrl: 'http://image.test/unsupported', showActionsMenu: true },
  });
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  const close = dialog.getByRole('button', { name: /close preview/i });
  await expect(close).toBeFocused();
  await expectIgnoredShortcut(page, 'Meta+c');
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(close)).toBe(false);
  await expect(dialog).toBeVisible();
});

test('chat copies original pixels only after thumbnail props are replaced by the original', async ({
  mount,
  page,
}) => {
  await captureImageClipboard(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatImageBlock, {
    props: {
      data: Buffer.from(thumbnailSvg).toString('base64'),
      mimeType: 'image/svg+xml',
      alt: 'diagram',
      dataIsThumbnail: true,
    },
  });
  const tile = component.getByRole('button', { name: /view.*full size/i });
  await tile.focus();
  await expectIgnoredShortcut(page, 'Meta+c');
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(tile)).toBe(false);
  await tile.click();
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  const close = dialog.getByRole('button', { name: /close preview/i });
  await expect(close).toBeFocused();
  await expectIgnoredShortcut(page, 'Meta+c');
  expect(await dispatchCopy(close)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await component.update({
    props: { data: imageData, mimeType: 'image/svg+xml', alt: 'diagram', dataIsThumbnail: false },
  });
  await component.getByRole('img').evaluate((node: HTMLImageElement) => node.decode());
  await tile.focus();
  await page.keyboard.press('Meta+c');
  await expectCopiedImage(page, 1);
  await page.keyboard.press('Control+c');
  await expectCopiedImage(page, 2);
  expect(await dispatchCopy(tile)).toBe(true);
  await expectCopiedImage(page, 3);
});

test('reserved chat frame keeps thumbnail actions guarded until original hydration', async ({
  mount,
  page,
}, testInfo) => {
  await captureImageClipboard(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let hydrations = 0;
  const component = await mount(ChatImageBlock, {
    props: {
      data: Buffer.from(thumbnailSvg).toString('base64'),
      mimeType: 'image/svg+xml',
      alt: 'diagram',
      width: 480,
      height: 240,
      dataTruncated: true,
      dataIsThumbnail: true,
      onHydrate: () => {
        hydrations += 1;
      },
    },
  });
  const frame = component.locator('[data-image-sized]');
  const image = component.getByRole('img');
  const thumbnailButton = component.getByRole('button', { name: /load full-size/i });
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await page.evaluate(() => document.fonts.ready);
  await expect(image).toHaveJSProperty('naturalWidth', 48);
  const before = (await frame.boundingBox())!;
  const thumbnailBox = (await image.boundingBox())!;
  expect(before.width).toBeGreaterThan(48);
  expect(before.width).toBeLessThan(480);
  expect(Math.abs(before.height - before.width / 2)).toBeLessThanOrEqual(1);
  expectSameBox((await thumbnailButton.boundingBox())!, before);
  await thumbnailButton.focus();
  await expectIgnoredShortcut(page, 'Meta+c');
  await expectIgnoredShortcut(page, 'Control+c');
  expect(await dispatchCopy(thumbnailButton)).toBe(false);
  await image.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(component.getByRole('button', { name: /image options/i })).toHaveCount(0);
  await thumbnailButton.click();
  await expect.poll(() => hydrations).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expectSameBox((await frame.boundingBox())!, before);

  await component.update({
    props: {
      data: imageData,
      mimeType: 'image/svg+xml',
      alt: 'diagram',
      width: 480,
      height: 240,
      dataTruncated: false,
      dataIsThumbnail: false,
      onHydrate: undefined,
    },
  });
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(image).toHaveJSProperty('naturalWidth', 480);
  const tile = component.getByRole('button', { name: /view.*full size/i });
  expectSameBox((await frame.boundingBox())!, before);
  expectSameBox((await tile.boundingBox())!, before);
  expectSameBox((await image.boundingBox())!, thumbnailBox);
  await tile.focus();
  await page.keyboard.press('Meta+c');
  await expectCopiedImage(page, 1);
  await image.click({ button: 'right' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toBeVisible();
  await testInfo.attach('reserved-chat-controls.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('menuitem', { name: /copy image/i }).click();
  await expectCopiedImage(page, 2);
  const trigger = component.getByRole('button', { name: /image options/i });
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+c');
  await expectCopiedImage(page, 3);
  await tile.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  await expect(dialog.getByRole('button', { name: /close preview/i })).toBeFocused();
  await page.keyboard.press('Control+c');
  const png = await expectCopiedImage(page, 4);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tile).toBeFocused();
  const final = (await frame.boundingBox())!;
  expectSameBox(final, before);
  await testInfo.attach('reserved-chat-geometry', {
    body: JSON.stringify({ before, final, thumbnailBox, originalBox: await image.boundingBox() }),
    contentType: 'application/json',
  });
  await testInfo.attach('reserved-chat-clipboard.png', { body: png, contentType: 'image/png' });
});

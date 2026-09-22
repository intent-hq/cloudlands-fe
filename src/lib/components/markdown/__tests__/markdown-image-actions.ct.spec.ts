import { readFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import MarkdownViewer from '../MarkdownViewer.svelte';
import ChatImageBlock from '../../chat/ChatImageBlock.svelte';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" rx="16" fill="#e8edf4"/><circle cx="120" cy="120" r="64" fill="#657ca8"/><path d="M240 152l48-64 72 64" fill="none" stroke="#657ca8" stroke-width="12"/></svg>';

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

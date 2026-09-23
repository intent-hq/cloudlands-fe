import { expect, test } from '../../../../test/ct-test';
import ChatMessage from '../ChatMessage.svelte';
import type { AgentMessage } from '$shared/types';

for (const imageSize of [
  { name: 'wide screenshot', width: 1600, height: 40 },
  { name: 'portrait screenshot', width: 40, height: 1600 },
]) {
  test(`sent ${imageSize.name} fills its thumbnail and opens by keyboard`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 500 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const data = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#2772df';
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(',')[1];
    }, imageSize);
    const message: AgentMessage = {
      id: 'synthetic-sent-image',
      role: 'user',
      timestamp: new Date('2026-01-01T12:00:00Z'),
      contentBlocks: [
        { type: 'text', text: 'Inspect the attached synthetic diagram.' },
        { id: 'synthetic-sent-image:1', type: 'image', data, mimeType: 'image/png' },
      ],
    };
    const component = await mount(ChatMessage, { props: { message, onEditSubmit: () => {} } });
    const thumbnail = component.getByRole('button', { name: /view attached image/i });
    const image = thumbnail.getByRole('img');
    await expect(image).toBeVisible();
    await image.evaluate((node: HTMLImageElement) => node.decode());
    await page.evaluate(() => document.fonts.ready);
    const buttonBox = (await thumbnail.boundingBox())!;
    expect(buttonBox.width).toBeGreaterThanOrEqual(24);
    expect(buttonBox.height).toBe(buttonBox.width);
    const imageBox = (await image.boundingBox())!;
    expect(imageBox).toEqual(buttonBox);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(
      imageSize.width,
    );
    await thumbnail.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /image preview/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('src', `data:image/png;base64,${data}`);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(thumbnail).toBeFocused();

    await component.getByText('Inspect the attached synthetic diagram.', { exact: true }).click();
    await expect(component.locator('.tiptap-editor')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(image).toBeVisible();
    expect(await image.boundingBox()).toEqual(buttonBox);

    await component.update({ props: { message, isSticky: true } });
    await expect(thumbnail).toHaveCount(0);
    await component.update({ props: { message, isSticky: false } });
    await expect(image).toBeVisible();
    expect(await image.boundingBox()).toEqual(buttonBox);
  });
}

test('a sent slim image reserves a full tile before its bytes arrive', async ({ mount }) => {
  const message: AgentMessage = {
    id: 'synthetic-slim-image',
    role: 'user',
    timestamp: new Date('2026-01-01T12:00:00Z'),
    contentBlocks: [{ id: 'synthetic-slim-image:0', type: 'image', dataTruncated: true }],
  };
  const component = await mount(ChatMessage, { props: { message } });
  const thumbnail = component.getByRole('button', { name: /view attached image/i });
  const placeholder = component.getByTestId('chat-message-image-placeholder');
  await expect(placeholder).toBeVisible();
  const buttonBox = (await thumbnail.boundingBox())!;
  expect(buttonBox.width).toBeGreaterThanOrEqual(24);
  expect(buttonBox.height).toBe(buttonBox.width);
  expect(await placeholder.boundingBox()).toEqual(buttonBox);
});

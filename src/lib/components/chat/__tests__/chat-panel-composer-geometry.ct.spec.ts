import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import {
  applyAuroraPaintProbe,
  colorDistance,
  isPaintProbe,
  samplePanelBottomPixels,
} from './aurora-panel-pixels';

test.setTimeout(120_000);

for (const chief of [false, true]) {
  test(`keeps ${chief ? 'Chief' : 'regular'} editing usable in a narrow panel at 200% zoom`, async ({
    mount,
  }) => {
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: {
        chief,
        width: 180,
        zoom: 2,
        streaming: true,
        draft: 'Long streaming draft '.repeat(12),
      },
    });
    const input = component.getByTestId('message-input');
    const editor = input.locator('.tiptap-editor');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.pressSequentially('Continue reviewing.');
    await expect(editor).toContainText('Continue reviewing.');

    await expect
      .poll(() =>
        input.evaluate((node) => {
          const editor = node.querySelector('.editor-wrapper')!;
          const actionBar = node.querySelector('[data-chat-input-action-bar]')!;
          return (
            [node, editor, actionBar].every(
              (element) => element.scrollWidth - element.clientWidth <= 1,
            ) &&
            editor.getBoundingClientRect().bottom <= actionBar.getBoundingClientRect().top + 0.5
          );
        }),
      )
      .toBe(true);
  });
}

test('clips streaming glow under the dark scroll fade at 200% zoom and removes it when idle', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = { theme: 'dark' as const, zoom: 2, width: 180, streaming: false };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const aurora = component.getByTestId('composer-aurora-host');
  const panel = component.locator('.panel');

  await expect(aurora).toHaveCount(0);
  await component.update({ props: { ...props, streaming: true } });
  await expect(aurora).toBeVisible();
  await applyAuroraPaintProbe(aurora);
  const clipped = await samplePanelBottomPixels(panel);
  clipped.outsideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(false));
  clipped.insideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(true));

  // Break clipping to prove that the pixel probe detects escaped paint.
  await panel.evaluate((node) => {
    (node as HTMLElement).style.setProperty('--panel-shell-radius', '0px');
  });
  try {
    const leaking = await samplePanelBottomPixels(panel);
    leaking.outsideCorners.forEach((corner, index) => {
      expect(isPaintProbe(corner)).toBe(true);
      expect(colorDistance(corner, clipped.outsideCorners[index])).toBeGreaterThan(100);
    });
  } finally {
    await panel.evaluate((node) => {
      (node as HTMLElement).style.removeProperty('--panel-shell-radius');
    });
  }

  await component.update({ props });
  await expect(aurora).toHaveCount(0);
});

test('keeps suggestions accessible and inserts them after resizing into compact mode', async ({
  mount,
}) => {
  const props = { width: 720, height: 960, suggestions: true };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const suggestions = component.getByTestId('suggested-prompts-surface');
  const list = component.getByTestId('suggested-prompts-list');
  const input = component.getByTestId('message-input');
  const gap = async () => {
    const [promptsBox, inputBox] = await Promise.all([
      suggestions.boundingBox(),
      input.boundingBox(),
    ]);
    return inputBox!.y - promptsBox!.y - promptsBox!.height;
  };

  await expect(list).toHaveAttribute('data-compact', 'false');
  await expect.poll(gap).toBeGreaterThan(0);
  await component.update({ props: { ...props, height: 480 } });
  await expect(list).toHaveAttribute('data-compact', 'true');
  await expect.poll(gap).toBeGreaterThan(0);

  await suggestions.getByRole('button', { name: 'Edit in input' }).first().click();
  await expect(input.locator('.tiptap-editor')).toContainText('Review the layout.');
  await expect.poll(gap).toBeGreaterThan(0);
});

test('supports attachment keyboard navigation, removal, and composer resizing', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { draft: 'Resizable attachment draft', width: 420 },
  });
  const input = component.getByTestId('message-input');
  const editor = component.locator('.tiptap-editor');
  const resize = input.locator('.resize-handle');
  await component.locator('input[type="file"]').setInputFiles({
    name: 'composer.png',
    mimeType: 'image/png',
    buffer: Buffer.from('composer-image'),
  });
  const attachment = component.getByRole('img', { name: 'composer.png' });
  await expect(attachment).toBeVisible();

  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(
    component.getByRole('button', { name: 'View composer.png full size' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Remove composer.png' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Default model' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(attachment).toHaveCount(0);

  const before = (await input.boundingBox())!.height;
  const handle = (await resize.boundingBox())!;
  const handleY = handle.y + handle.height / 2;
  await resize.dispatchEvent('mousedown', { clientY: handleY });
  await page.evaluate((clientY) => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY }));
  }, handleY - 60);
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(before);
});

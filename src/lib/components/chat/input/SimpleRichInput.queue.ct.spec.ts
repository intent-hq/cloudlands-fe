import { expect, test } from '../../../../test/ct-test';
import SimpleRichInputQueueHost from './SimpleRichInputQueueHost.svelte';

// With no queue the prompt text sits directly below the composer padding-top
// (8px) plus the `.tiptap-editor` padding-top (0.25rem = 4px) scoped in
// TipTapEditor.svelte. The value is asserted as a constant rather than sampled
// after mount: on CI the editor's scoped stylesheet can apply after the
// visibility/placeholder gates, so a mount-time sample (or a getComputedStyle
// oracle taken at the same instant) pinned a stale 8-9px baseline the settled
// composer never matched (intent-hq/intent#5324).
const EMPTY_TEXT_INSET = 12;

test('preserves the empty composer and insets prompt text below expanded and collapsed queues', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(SimpleRichInputQueueHost, { props: { queueCount: 0, width: 240 } });
  const input = component.getByTestId('message-input');
  const queue = component.locator('[data-chat-input-queue-region]');
  const editor = component.locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(editor.locator('p')).toHaveAttribute('data-placeholder', /.+/);
  const surfaceTextInset = () =>
    input.evaluate(
      (node) =>
        node.querySelector('.tiptap-editor p')!.getBoundingClientRect().top -
        node.getBoundingClientRect().top,
    );
  // Settle on the CSS-defined inset before any other geometry is sampled, so
  // every read below sees the editor's scoped styles applied.
  await expect.poll(surfaceTextInset).toBe(EMPTY_TEXT_INSET);
  const geometry = await input.evaluate((node) => {
    const surface = node.getBoundingClientRect();
    const text = node.querySelector('.tiptap-editor p')!.getBoundingClientRect();
    const actions = node.querySelector('.action-bar')!.getBoundingClientRect();
    return { top: text.top - surface.top, bottom: actions.top - text.bottom };
  });
  expect(geometry.top).toBe(EMPTY_TEXT_INSET);
  expect(Math.abs(geometry.bottom - geometry.top)).toBeLessThanOrEqual(4);
  expect(await queue.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  const emptyBox = await input.boundingBox();
  const queueEditorGap = () =>
    input.evaluate((node) => {
      const queue = node.querySelector('[data-chat-input-queue-region]')!.getBoundingClientRect();
      const editor = node.querySelector('.editor-wrapper')!.getBoundingClientRect();
      return editor.top - queue.bottom;
    });
  const queueTextInset = () =>
    input.evaluate((node) => {
      const queue = node.querySelector('[data-chat-input-queue-region]')!.getBoundingClientRect();
      const text = node.querySelector('.tiptap-editor p')!.getBoundingClientRect();
      return text.top - queue.bottom;
    });
  const typedTextInset = () =>
    input.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node.querySelector('.tiptap-editor p')!);
      return (
        range.getBoundingClientRect().top -
        node.querySelector('[data-chat-input-queue-region]')!.getBoundingClientRect().bottom
      );
    });
  expect(await queueEditorGap()).toBe(0);

  await component.update({ props: { queueCount: 1, width: 240 } });
  await expect(queue.getByTestId('queued-message-row')).toBeVisible();
  expect(await queue.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe('0px');
  await expect.poll(queueEditorGap).toBe(8);
  await expect.poll(queueTextInset).toBe(12);
  await editor.fill('Draft message');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Draft message');
  await expect.poll(queueTextInset).toBe(12);
  const expandedTypedInset = await typedTextInset();
  expect(expandedTypedInset).toBeGreaterThanOrEqual(12);
  expect(expandedTypedInset).toBeLessThanOrEqual(14);
  const header = queue.getByTestId('queued-messages-disclosure');
  expect((await header.boundingBox())!.height).toBe(28);
  expect((await header.boundingBox())!.y - (await input.boundingBox())!.y).toBe(4);
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(queue.getByTestId('queued-message-row')).toHaveCount(0);
  await expect(queue.getByTestId('queued-messages-container')).toHaveCSS('padding-top', '0px');
  await expect.poll(queueEditorGap).toBe(8);
  await expect.poll(queueTextInset).toBe(12);
  expect(await typedTextInset()).toBe(expandedTypedInset);
  expect((await header.boundingBox())!.height).toBe(28);
  const collapsedHeaderBox = (await header.boundingBox())!;
  const collapsedEditorBox = (await input.locator('.editor-wrapper').boundingBox())!;
  expect(collapsedHeaderBox.y).toBe((await input.boundingBox())!.y);
  expect(collapsedEditorBox.y - collapsedHeaderBox.y - collapsedHeaderBox.height).toBe(9);
  // Refocus before selecting through ProseMirror's keyboard transaction path.
  await editor.focus();
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
  await expect(editor).toHaveText('');
  await expect(editor.locator('p')).toHaveAttribute('data-placeholder', /.+/);
  await expect.poll(queueTextInset).toBe(12);
  await component.update({ props: { queueCount: 0, width: 240 } });
  await expect(header).toHaveCount(0);
  await expect.poll(queueEditorGap).toBe(0);
  await expect.poll(() => input.boundingBox()).toEqual(emptyBox);
  await expect.poll(surfaceTextInset).toBe(EMPTY_TEXT_INSET);
});

for (const streaming of [false, true]) {
  test(`keeps the editor and ${streaming ? 'stop' : 'send'} reachable with twelve queued messages`, async ({
    mount,
    page,
  }) => {
    const component = await mount(SimpleRichInputQueueHost, { props: { streaming } });
    const input = component.getByTestId('message-input');
    const queue = component.locator('[data-chat-input-queue-region]');
    const editor = component.locator('.tiptap-editor');
    const action = component.getByRole('button', {
      name: streaming ? 'Stop streaming' : 'Send message',
      exact: true,
    });
    if (!streaming) await editor.fill('A new message');

    await expect
      .poll(() =>
        input.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          const editor = node.querySelector('.editor-wrapper')!.getBoundingClientRect();
          const text = node.querySelector('.tiptap-editor p')!.getBoundingClientRect();
          const queue = node
            .querySelector('[data-chat-input-queue-region]')!
            .getBoundingClientRect();
          const controls = node
            .querySelector('[data-chat-input-submit-actions]')!
            .getBoundingClientRect();
          return (
            editor.height >= 20 &&
            editor.top - queue.bottom >= 8 &&
            text.top - queue.bottom >= 12 &&
            editor.top >= bounds.top &&
            editor.bottom <= controls.top &&
            controls.bottom <= bounds.bottom
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        queue.evaluate((node) => node.scrollHeight > node.clientHeight && node.clientHeight > 0),
      )
      .toBe(true);
    await queue.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => queue.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await editor.click();
    await expect(editor).toBeFocused();
    await action.click();
    await expect(component.locator('output')).toHaveText(streaming ? 'stopped' : 'sent');
  });
}

import { expect, test } from '@playwright/experimental-ct-svelte';
import SimpleRichInputQueueHost from './SimpleRichInputQueueHost.svelte';

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
          const controls = node
            .querySelector('[data-chat-input-submit-actions]')!
            .getBoundingClientRect();
          return (
            editor.height >= 20 &&
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

import { expect, test } from '@playwright/experimental-ct-svelte';
import SimpleRichInputQueueHost from './SimpleRichInputQueueHost.svelte';

test('balances the empty composer inset and restores spacing when the queue has content', async ({
  mount,
}) => {
  const component = await mount(SimpleRichInputQueueHost, { props: { queueCount: 0 } });
  const input = component.getByTestId('message-input');
  const queue = component.locator('[data-chat-input-queue-region]');
  await expect(component.locator('.tiptap-editor')).toBeVisible();
  const geometry = await input.evaluate((node) => {
    const surface = node.getBoundingClientRect();
    const text = node.querySelector('.tiptap-editor p')!.getBoundingClientRect();
    const actions = node.querySelector('.action-bar')!.getBoundingClientRect();
    return { top: text.top - surface.top, bottom: actions.top - text.bottom };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(8);
  expect(geometry.top).toBeLessThanOrEqual(12);
  expect(Math.abs(geometry.bottom - geometry.top)).toBeLessThanOrEqual(4);
  expect(await queue.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);

  await component.update({ props: { queueCount: 1 } });
  await expect(queue.getByTestId('queued-message-row')).toBeVisible();
  expect(await queue.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe('4px');
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

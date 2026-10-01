import { expect, test } from '../../../../test/ct-test';
import SimpleRichInputQueueHost from './SimpleRichInputQueueHost.svelte';

test('keeps queued messages above subscriptions without moving the composer', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(SimpleRichInputQueueHost, { props: { queueCount: 0, width: 240 } });
  const input = component.getByTestId('message-input');
  const editor = input.locator('.tiptap-editor');
  const queue = component.getByTestId('queued-messages-container');
  const subscriptions = component.getByTestId('event-subscriptions-card');
  await expect(editor).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const textInset = () =>
    input.evaluate(
      (node) =>
        node.querySelector('.tiptap-editor p')!.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        node.clientTop,
    );
  await expect.poll(textInset).toBe(12);
  const emptyBox = await input.boundingBox();
  await expect(queue).toHaveCount(0);

  await component.update({ props: { queueCount: 1, width: 240 } });
  await expect(queue.getByTestId('queued-message-row')).toBeVisible();
  await expect(input.getByTestId('queued-messages-container')).toHaveCount(0);
  await expect.poll(() => input.boundingBox()).toEqual(emptyBox);
  const queueBox = (await queue.boundingBox())!;
  const subscriptionsBox = (await subscriptions.boundingBox())!;
  expect(queueBox.y + queueBox.height).toBeLessThanOrEqual(subscriptionsBox.y);
  expect(subscriptionsBox.y + subscriptionsBox.height).toBeLessThanOrEqual(emptyBox!.y);
  await editor.fill('Draft message');
  await expect(editor).toBeFocused();
  const header = queue.getByTestId('queued-messages-disclosure');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(queue.getByTestId('queued-message-row')).toHaveCount(0);
  await expect.poll(() => input.boundingBox()).toEqual(emptyBox);
  await expect(editor).toHaveText('Draft message');
  await header.click();
  await testInfo.attach('queue-above-subscriptions-and-composer', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { queueCount: 0, width: 240 } });
  await expect(queue).toHaveCount(0);
  await expect.poll(() => input.boundingBox()).toEqual(emptyBox);
  await expect.poll(textInset).toBe(12);
});

for (const streaming of [false, true]) {
  test(`keeps the editor and ${streaming ? 'stop' : 'send'} reachable with twelve queued messages`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(SimpleRichInputQueueHost, { props: { streaming } });
    const input = component.getByTestId('message-input');
    const queue = component.getByTestId('queued-messages-container');
    const editor = input.locator('.tiptap-editor');
    const action = component.getByRole('button', {
      name: streaming ? 'Stop streaming' : 'Send message',
      exact: true,
    });
    if (!streaming) await editor.fill('A new message');
    const composerBox = await input.boundingBox();
    await queue.getByRole('button', { name: 'Show all queued messages' }).click();
    const queueViewport = queue.getByTestId('queued-messages-viewport');
    await expect
      .poll(() =>
        queueViewport.evaluate(
          (node) => node.scrollHeight > node.clientHeight && node.clientHeight > 0,
        ),
      )
      .toBe(true);
    await queueViewport.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => queueViewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => input.boundingBox()).toEqual(composerBox);
    await expect(action).toBeInViewport();
    await editor.click();
    await expect(editor).toBeFocused();
    await testInfo.attach('expanded-queue-above-composer', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await action.click();
    await expect(component.locator('output')).toHaveText(streaming ? 'stopped' : 'sent');
  });
}

import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

// Exercise the production transcript, not a fixture copy of its spacing classes (#4657).
const cases = [
  { status: 'thinking', pendingEvent: false },
  { status: 'error', pendingEvent: false },
  { status: 'model-unavailable', pendingEvent: false },
  { status: 'thinking', pendingEvent: true },
] as const;

for (const { status, pendingEvent } of cases) {
  test(`separates ${pendingEvent ? 'event' : 'human'} prompt from pending ${status}`, async ({
    mount,
  }, testInfo) => {
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { pendingAssistantStatus: status, pendingEvent, width: 560 },
    });
    const sourceId = pendingEvent ? 'event-pending' : 'user-pending';
    const source = component.locator(`[data-message-id="${sourceId}"]`);
    const statusRow = component.locator(
      status === 'thinking' ? '[data-streaming-typing-row]' : '[data-stream-terminal-error]',
    );
    await expect(source).toBeVisible();
    await expect(statusRow).toBeVisible();
    await component.evaluate(async () => {
      await document.fonts.ready;
    });

    const measure = () =>
      source.evaluate((node) => {
        const previous = document.querySelector('[data-message-id="user-before-pending"]')!;
        const status = node
          .closest('[data-conversation-turn]')!
          .querySelector('[data-streaming-typing-row], [data-stream-terminal-error]')!;
        return {
          cardGap: node.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
          statusGap: status.getBoundingClientRect().top - node.getBoundingClientRect().bottom,
        };
      });
    await expect.poll(async () => (await measure()).cardGap).toBeCloseTo(16, 1);
    await testInfo.attach('pending-status-geometry', {
      body: JSON.stringify(await measure()),
      contentType: 'application/json',
    });
    await testInfo.attach('pending-status', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await expect.poll(async () => (await measure()).statusGap).toBeCloseTo(24, 1);

    if (status !== 'thinking') return;
    await component.update({ props: { pendingAssistantStatus: 'idle' } });
    await expect(statusRow).toHaveCount(0);
    await expect(source).toHaveCSS('margin-bottom', '0px');

    await component.update({ props: { pendingAssistantStatus: 'thinking' } });
    await expect(statusRow).toBeVisible();
    await expect.poll(async () => (await measure()).statusGap).toBeCloseTo(24, 1);

    await component.update({ props: { pendingAssistantStatus: 'reply' } });
    const reply = component.locator('[data-message-id="assistant-pending"]');
    await expect(reply).toBeVisible();
    await expect(statusRow).toHaveCount(0);
    await expect
      .poll(() =>
        reply.evaluate((node, id) => {
          const source = document.querySelector(`[data-message-id="${id}"]`)!;
          return node.getBoundingClientRect().top - source.getBoundingClientRect().bottom;
        }, sourceId),
      )
      .toBeCloseTo(24, 1);
  });
}

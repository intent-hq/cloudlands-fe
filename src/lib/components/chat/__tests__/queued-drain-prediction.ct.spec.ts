import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import { QUEUE_DRAIN_PREDICTION_TIMEOUT_MS } from '../queue-drain-prediction';

test.setTimeout(120_000);

const props = { width: 620, height: 700, transcript: true, queued: true };
const QUEUED_TEXT = 'Check the narrow layout too.';

test('shows a queued message as sent as soon as the turn ends', async ({ mount, page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: true },
  });
  const queue = component.getByTestId('queued-messages-container');
  const row = component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT });
  await expect(queue).toContainText(QUEUED_TEXT);
  await expect(row).toHaveCount(0);

  // The turn ends; the daemon has not started the queued turn yet.
  await component.update({ props: { ...props, streaming: false } });

  await expect(row).toBeVisible();
  await expect(queue).toHaveCount(0);
  await expect(
    component.locator('[data-streaming-typing-row]:not([aria-hidden="true"])'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('predicted-drain.png') });
});

test('does not show queued work as sent for an agent that is already idle', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: false },
  });
  await expect(component.getByTestId('queued-messages-container')).toContainText(QUEUED_TEXT);
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT }),
  ).toHaveCount(0);
});

test('returns the message to the queue when the daemon never starts the turn', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: true },
  });
  const queue = component.getByTestId('queued-messages-container');
  const row = component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT });
  await expect(queue).toContainText(QUEUED_TEXT);

  await component.update({ props: { ...props, streaming: false } });
  await expect(row).toBeVisible();

  await page.clock.runFor(QUEUE_DRAIN_PREDICTION_TIMEOUT_MS + 100);
  await expect(queue).toContainText(QUEUED_TEXT);
  await expect(row).toHaveCount(0);
});

test('hands the row to the daemon once the queued entry is delivered', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: true },
  });
  const row = component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT });
  await component.update({ props: { ...props, streaming: false } });
  await expect(row).toBeVisible();

  // The drained turn starts and the entry leaves the queue.
  await component.update({ props: { ...props, streaming: true, queued: false } });
  await expect(row).toHaveCount(0);
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
});

test('keeps queued messages in the queue when the user stops the turn', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The daemon stamps the stopped turn's final assistant row (PROTOCOL §7.2);
  // agent.stop leaves the queue untouched, so nothing is about to be sent.
  const stopped = {
    queued: true,
    width: 620,
    height: 700,
    messages: [
      {
        id: 'stopped-user',
        role: 'user' as const,
        timestamp: '2026-11-03T12:00:00.000Z',
        contentBlocks: [{ type: 'text' as const, text: 'Start the long task.' }],
      },
      {
        id: 'stopped-assistant',
        role: 'assistant' as const,
        timestamp: '2026-11-03T12:00:05.000Z',
        contentBlocks: [{ type: 'text' as const, text: 'Working on it' }],
        metadata: { stopReason: 'interrupted', interruptReason: 'user_stop' as const },
      },
    ],
  };
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...stopped, streaming: true },
  });
  const queue = component.getByTestId('queued-messages-container');
  await expect(queue).toContainText(QUEUED_TEXT);

  await component.update({ props: { ...stopped, streaming: false } });

  await expect(queue).toContainText(QUEUED_TEXT);
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT }),
  ).toHaveCount(0);
});

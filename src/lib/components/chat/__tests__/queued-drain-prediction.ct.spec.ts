import { expect, installPausedClock, test } from '../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import { SHORTCUT_DEFAULTS } from '$lib/utils/shortcut-bindings';
import { shortcutChord } from '../../../../test/shortcut-chords';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import { QUEUE_DRAIN_PREDICTION_TIMEOUT_MS } from '../queue-drain-prediction';

test.setTimeout(120_000);

const props = { width: 620, height: 700, transcript: true, queued: true };
const QUEUED_TEXT = 'Check the narrow layout too.';

for (const submissionSupport of [false, true]) {
  test(`preserves a persisted queue head restored without a failure flag (correlation ${submissionSupport})`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: {
        ...props,
        submissionSupport,
        streaming: true,
        messages: [
          {
            id: 'persisted-delivery',
            role: 'user',
            timestamp: '2026-11-10T12:00:00.000Z',
            contentBlocks: [{ type: 'text', text: QUEUED_TEXT }],
            metadata: { queueInfo: { queuedMessageId: 'attention-queue-fixture' } },
          },
        ],
      },
    });
    await expect(component.getByTestId('queued-messages-container')).toContainText(QUEUED_TEXT);
    await expect(
      component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT }),
    ).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('delivered-queue-cleared.png') });
  });
}

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
  // Paused: the row must still be visible before the drain timeout, which a slow runner
  // could otherwise let run out between the update and the check.
  const component = await installPausedClock(page, () =>
    mount(ChatPanelComposerGeometryHost, { props: { ...props, streaming: true } }),
  );
  const queue = component.getByTestId('queued-messages-container');
  const row = component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT });
  await expect(queue).toContainText(QUEUED_TEXT);

  await component.update({ props: { ...props, streaming: false } });
  // A few frames for the transcript to render the predicted row, far inside the timeout.
  await page.clock.runFor(500);
  await expect(row).toBeVisible();

  await page.clock.runFor(QUEUE_DRAIN_PREDICTION_TIMEOUT_MS);
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

test('keeps queued messages in the queue when another client stops the turn during startup', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A startup-window Stop from another client: this view never clicked Stop,
  // and the interrupt terminal names no row (PROTOCOL §7.2), so no assistant
  // row is marked interrupted. agent.stop leaves the queue untouched.
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: true, interruptedTurnEnd: true },
  });
  const queue = component.getByTestId('queued-messages-container');
  await expect(queue).toContainText(QUEUED_TEXT);

  await component.update({ props: { ...props, streaming: false, interruptedTurnEnd: true } });

  await expect(queue).toContainText(QUEUED_TEXT);
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT }),
  ).toHaveCount(0);
});

const FORCED_TEXT = 'Stop and do this instead';
const forced = { ...props, submissionSupport: true };

async function forceSend(component: Locator, page: Page, pausedClock = false) {
  await expect(component.getByTestId('queued-messages-container')).toContainText(QUEUED_TEXT);
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.click();
  await editor.pressSequentially(FORCED_TEXT);
  if (pausedClock) await page.clock.runFor(500);
  const isMac = await page.evaluate(() => /Mac/i.test(navigator.platform));
  await editor.press(shortcutChord(SHORTCUT_DEFAULTS['chat.force-send'], isMac).press);
  if (pausedClock) await page.clock.runFor(500);
  await expect(component.getByText(FORCED_TEXT, { exact: true })).toHaveCount(1);
}

// ⌘Enter interrupts the turn with the composer text only. The daemon runs that
// message next and keeps the queue for after it (PROTOCOL §5.5).
test('keeps queued messages in the queue when a force-sent message preempts the turn', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Store selector readables coalesce writes on animation frames. Step each
  // intended turn boundary explicitly: a fast true/false pulse can disappear.
  const component = await installPausedClock(page, () =>
    mount(ChatPanelComposerGeometryHost, { props: { ...forced, streaming: true } }),
  );
  await forceSend(component, page, true);
  const queue = component.getByTestId('queued-messages-container');
  const queuedRow = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: QUEUED_TEXT });

  // The preempted turn ends before the forced message reaches the transcript.
  await component.update({ props: { ...forced, streaming: false } });
  await page.clock.runFor(500);
  await expect(queue).toContainText(QUEUED_TEXT);
  await expect(queuedRow).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('force-send-keeps-queue.png') });

  // Confirm the forced submission and allow the renderer to observe its turn
  // starting before ending it. Text alone also matches the optimistic row.
  await component.update({ props: { ...forced, streaming: true, settleSubmission: 'history' } });
  await page.clock.runFor(500);
  await expect(component.getByTestId('stored-messages')).toContainText(FORCED_TEXT);
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: FORCED_TEXT }),
  ).toHaveCount(1);
  // The forced turn runs and ends on its own: now the daemon drains the queue.
  await component.update({ props: { ...forced, streaming: false, settleSubmission: 'history' } });
  await page.clock.runFor(500);
  await expect(queuedRow).toBeVisible();
  await expect(queue).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('force-send-then-drain.png') });
});

test('keeps queued messages in the queue when the forced message lands before the turn ends', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...forced, streaming: true },
  });
  await forceSend(component, page);
  await component.update({ props: { ...forced, streaming: true, settleSubmission: 'history' } });
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: FORCED_TEXT }),
  ).toHaveCount(1);

  await component.update({ props: { ...forced, streaming: false, settleSubmission: 'history' } });
  await expect(component.getByTestId('queued-messages-container')).toContainText(QUEUED_TEXT);
  await expect(
    component.locator('[data-message-role="user"]').filter({ hasText: QUEUED_TEXT }),
  ).toHaveCount(0);
});

for (const edge of ['agent:queue:processing', 'agent:idle', 'agent:failed', 'agent:stream:end']) {
  test(`reconciles a missed queue shrink on ${edge}`, async ({ mount, page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { ...props, queueLifecycle: true, submissionSupport: true, streaming: true },
    });
    const queue = component.getByTestId('queued-messages-container');
    await expect(queue).toContainText(QUEUED_TEXT);
    const before = await page.evaluate(() => window.__queueLifecycle!.reads());
    await page.evaluate((type) => {
      window.__queueLifecycle!.setResponse([]);
      window.__queueLifecycle!.emit(type, {
        messageId: 'attention-queue-fixture',
        turnId: 'attention-queue-fixture',
      });
    }, edge);
    await expect
      .poll(() => page.evaluate(() => window.__queueLifecycle!.reads()))
      .toBeGreaterThan(before);
    await expect(queue).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('reconciled-queue.png') });
  });
}

test('a newer queue snapshot protects an edited retry from an older reconciliation read', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, queueLifecycle: true, submissionSupport: true, streaming: true },
  });
  const queue = component.getByTestId('queued-messages-container');
  await expect(queue).toContainText(QUEUED_TEXT);
  const before = await page.evaluate(() => window.__queueLifecycle!.reads());
  await page.evaluate(() => {
    window.__queueLifecycle!.setResponse([], true);
    window.__queueLifecycle!.emit('agent:queue:processing', {
      messageId: 'attention-queue-fixture',
      turnId: 'attention-queue-fixture',
    });
  });
  await expect
    .poll(() => page.evaluate(() => window.__queueLifecycle!.reads()))
    .toBeGreaterThan(before);
  await page.evaluate(() => {
    window.__queueLifecycle!.emit('agent:queue:updated', {
      queue: [
        {
          id: 'attention-queue-fixture',
          content: 'Edited retry remains queued',
          queuedAt: '2026-11-10T12:00:00Z',
          position: 0,
          requeuedAfterFailure: false,
        },
      ],
    });
    window.__queueLifecycle!.release();
  });
  await expect(queue).toContainText('Edited retry remains queued');
  await page.screenshot({ path: info.outputPath('edited-retry-preserved.png') });
});

test('keeps new local text on a confirmed queue base with an old transcript identity', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: {
      ...props,
      submissionSupport: true,
      queuePhase: 'ready',
      streaming: true,
      messages: [
        {
          id: 'old-persisted-head',
          role: 'user',
          timestamp: '2026-11-10T12:00:00Z',
          contentBlocks: [{ type: 'text', text: 'Old delivery' }],
          metadata: { queueInfo: { queuedMessageId: 'queue-a' } },
        },
      ],
    },
  });
  const queue = component.getByTestId('queued-messages-container');
  await expect(queue).toBeVisible();
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.pressSequentially('New pending contribution');
  await editor.press('Enter');
  await expect(queue).toContainText('New pending contribution');
  await page.screenshot({ path: info.outputPath('pending-contribution-preserved.png') });
});

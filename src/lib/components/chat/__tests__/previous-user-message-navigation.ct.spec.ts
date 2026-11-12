import type { Locator } from '@playwright/experimental-ct-svelte';
import type { AgentMessage } from '$shared/types';
import {
  activateHoverAction,
  expect,
  expectMotionToSettle,
  pauseClock,
  test,
  wheelUntilScrolled,
} from '../../../../test/ct-test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

// How long the transcript must stay still before a destination counts as settled. Longer
// than the helper's default so focus, lazy layout and follow-bottom corrections that run a
// few frames after the scroll animation have also landed.
const DESTINATION_QUIET_MS = 300;

// Start "Previous user message" navigation from `source` without hovering it. Hover-only
// actions stay focusable (`message-action-surface.ts`), so Enter reaches them directly.
// A hover would hit-test the row first and retry until the test times out while
// follow-bottom or a scroll is still moving it. The helper waits for the transcript to
// settle before and after the press; the caller asserts where navigation ends up.
async function pressPreviousUserMessage(component: Locator, source: Locator) {
  await activateHoverAction(
    source.getByRole('button', { name: 'Previous user message' }),
    component.getByTestId('chat-transcript-scroll-viewport'),
    { requireChange: false },
  );
}

function bottomArrow(component: Locator) {
  const command = component.getByTestId('chat-floating-scroll-to-bottom-button');

  return {
    async expectAtBottom(atBottom: boolean) {
      if (atBottom) {
        await expect(command).toBeHidden();
      } else {
        await expect(command).toBeVisible();
      }
    },
  };
}

for (const sourceRole of ['user', 'assistant'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${sourceRole} previous-message action skips automated turns and reaches a lazy first message with ${reducedMotion} motion`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      const message = (
        id: string,
        role: AgentMessage['role'],
        text: string,
        metadata?: AgentMessage['metadata'],
      ): AgentMessage => ({
        id,
        role,
        timestamp: '2026-08-16T04:00:00.000Z',
        contentBlocks: [{ type: 'text', text }],
        metadata,
      });
      const messages = [
        message('first', 'user', 'First authored prompt', { type: 'question_answers' }),
        message('response-first', 'assistant', 'Long earlier response. '.repeat(600)),
        ...Array.from({ length: 22 }, (_, index) => [
          message(`automated-${index}`, 'user', '[TASK WAKE] A background update', {
            ...[
              { type: 'hook_wake' },
              { type: 'pr_monitor_wake' },
              { source: 'system' },
              { fromAgentId: 'agent-9' },
            ][index % 4],
          }),
          message(`response-automated-${index}`, 'assistant', 'Background response. '.repeat(14)),
        ]).flat(),
        message('last', 'user', 'Last authored prompt'),
        message('response-last', 'assistant', 'Latest response. '.repeat(14)),
      ];
      const component = await mount(ChatMessageNavigatorIntegrationHost, { props: { messages } });
      const scroll = component.getByTestId('chat-transcript-scroll-viewport');
      const down = bottomArrow(component);
      await down.expectAtBottom(true);
      const first = component.locator('[data-message-id="first"]');
      await expect(first.locator('[data-lazy-visible]')).toHaveAttribute(
        'data-lazy-visible',
        'false',
      );
      const sourceId = sourceRole === 'assistant' ? 'response-automated-21' : 'last';
      const source = component.locator(`[data-message-id="${sourceId}"]`);
      await activateHoverAction(
        source.getByRole('button', {
          name: sourceRole === 'assistant' ? 'Previous user message' : 'Scroll to previous message',
        }),
        scroll,
        { quietMs: DESTINATION_QUIET_MS },
      );
      await expect(first).toContainText('First authored prompt');
      const offset = await first.evaluate(
        (node, container) =>
          node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
        await scroll.elementHandle(),
      );
      expect(Math.abs(offset)).toBeLessThanOrEqual(3);
      await down.expectAtBottom(false);
      if (sourceRole === 'assistant') {
        const readingPosition = await scroll.evaluate((node) => node.scrollTop);
        await component
          .getByTestId('append-streaming-message')
          .evaluate((node: HTMLButtonElement) => node.click());
        await page.waitForTimeout(700);
        expect(await scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0);
      }
      // The appended streaming message can still move the row, so do not click through a
      // hover. The transcript may already be at the top, so wait for the end state rather
      // than a change, then for it to stay there.
      await activateHoverAction(
        first.getByRole('button', { name: 'Scroll to previous message' }),
        scroll,
        { requireChange: false, quietMs: DESTINATION_QUIET_MS },
      );
      await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
      await expectMotionToSettle(scroll, { quietMs: DESTINATION_QUIET_MS });
      const fallbackPosition = await scroll.evaluate((node) => node.scrollTop);
      expect(fallbackPosition).toBe(0);
      await testInfo.attach('first-message-navigation', {
        body: JSON.stringify({ reducedMotion, offset, fallbackPosition }),
        contentType: 'application/json',
      });
      await component.screenshot({ path: testInfo.outputPath('first-message-fallback.png') });
    });
  }
}

test('assistant navigation falls back to the top without an earlier human message', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const messages: AgentMessage[] = [
    {
      id: 'wake',
      role: 'user',
      timestamp: '2026-09-29T06:00:00Z',
      metadata: { source: 'system' },
      contentBlocks: [{ type: 'text', text: 'Automated wake' }],
    },
    {
      id: 'reply',
      role: 'assistant',
      timestamp: '2026-09-29T06:00:01Z',
      contentBlocks: [{ type: 'text', text: 'A long background reply. '.repeat(300) }],
    },
  ];
  const component = await mount(ChatMessageNavigatorIntegrationHost, { props: { messages } });
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  await bottomArrow(component).expectAtBottom(true);
  expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const action = component
    .locator('[data-message-id="reply"]')
    .getByRole('button', { name: 'Previous user message' });
  await action.focus();
  await action.press('Enter');
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
});

test('keyboard message navigation releases follow and can return to bottom', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  await expect(component.locator('.tiptap-editor')).toBeEditable();
  await component.evaluate(() => document.fonts.ready);
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const down = bottomArrow(component);
  await down.expectAtBottom(true);
  const bottom = await scroll.evaluate((node) => node.scrollTop);
  const navigationSteps = 6;
  for (let step = 0; step < navigationSteps; step++) {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('navigate-message', { detail: { direction: 'previous' } }),
      ),
    );
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  const target = component.locator('[data-message-id="user-23"]');
  const readingPosition = await scroll.evaluate((node) => node.scrollTop);
  await testInfo.attach('keyboard-reading-position', {
    body: JSON.stringify({
      bottom,
      readingPosition,
      bottomDistance: await scroll.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    }),
    contentType: 'application/json',
  });
  expect(readingPosition).toBeLessThan(bottom);
  await expect(target).toBeInViewport({ ratio: 1 });
  await down.expectAtBottom(false);
  await component.screenshot({ path: testInfo.outputPath('keyboard-reading-position.png') });
  for (let step = 0; step < navigationSteps; step++) {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('navigate-message', { detail: { direction: 'next' } })),
    );
    await page.waitForTimeout(200);
  }
  await down.expectAtBottom(true);
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
  await testInfo.attach('keyboard-navigation', {
    body: JSON.stringify({
      bottom,
      readingPosition,
      returnedPosition: await scroll.evaluate((node) => node.scrollTop),
      bottomDistance: await scroll.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    }),
    contentType: 'application/json',
  });
  await component.screenshot({ path: testInfo.outputPath('keyboard-return-to-bottom.png') });
});

function historyMessage(
  id: string,
  role: AgentMessage['role'],
  text: string,
  seq: number,
): AgentMessage {
  return {
    id,
    role,
    seq,
    timestamp: '2026-09-29T06:00:00Z',
    contentBlocks: [{ type: 'text', text }],
  };
}

test('history-only assistant navigates to its loaded human prompt', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      historyMessages: [
        historyMessage('older-human', 'user', 'Earlier prompt', 1),
        historyMessage('older-reply', 'assistant', 'Earlier answer. '.repeat(80), 2),
        historyMessage('history-human', 'user', 'The loaded history prompt', 3),
        historyMessage('history-reply', 'assistant', 'The loaded history response. '.repeat(30), 4),
      ],
      messages: [
        historyMessage('live-human', 'user', 'Latest prompt', 5),
        historyMessage('live-reply', 'assistant', 'Latest response. '.repeat(80), 6),
      ],
    },
  });
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const source = component.locator('[data-message-id="history-reply"]');
  await pressPreviousUserMessage(component, source);
  const target = component.locator('[data-message-id="history-human"]');
  await expect
    .poll(async () =>
      Math.abs(
        await target.evaluate(
          (node, container) =>
            node.getBoundingClientRect().top -
            (container as HTMLElement).getBoundingClientRect().top,
          await scroll.elementHandle(),
        ),
      ),
    )
    .toBeLessThanOrEqual(3);
  expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
});

test('previous-message actions remain available at unloaded history boundaries', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      historyGap: true,
      historyStartLoaded: false,
      historyMessages: [
        historyMessage('history-orphan', 'assistant', 'Earlier prompt is not loaded', 2),
        historyMessage('history-human', 'user', 'Loaded older prompt', 3),
        historyMessage('history-reply', 'assistant', 'Loaded older answer', 4),
      ],
      messages: [
        historyMessage('live-orphan', 'assistant', 'Prompt is inside the unloaded gap', 10),
        historyMessage('live-human', 'user', 'Loaded latest prompt', 11),
        historyMessage('live-reply', 'assistant', 'Loaded latest answer. '.repeat(80), 12),
      ],
    },
  });
  // A detached window renders alone: the live tail is never shown behind a gap.
  await expect(component.getByTestId('chat-history-forward-edge')).toHaveCount(1);
  for (const id of ['live-orphan', 'live-human', 'live-reply']) {
    await expect(component.locator(`[data-message-id="${id}"]`)).toHaveCount(0);
  }
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  // Follow-bottom keeps the transcript pinned, so each hover's scroll into view is pulled
  // back and its hit test retries until the test times out under load. Wheel up as a
  // reader would to release it, so the rows stay still while they are hovered.
  await wheelUntilScrolled(scroll, { deltaY: -2000 });
  await expectMotionToSettle(scroll);
  // A wheel that scrolled and was pulled back still counts as scrolled, so check the
  // release itself; otherwise a regression would resurface as the hover hang above.
  await bottomArrow(component).expectAtBottom(false);
  for (const id of ['history-orphan']) {
    const row = component.locator(`[data-message-id="${id}"]`);
    await row.hover();
    await expect(row.getByRole('button', { name: 'Previous user message' })).toBeVisible();
  }
  for (const id of ['history-human']) {
    const row = component.locator(`[data-message-id="${id}"]`);
    await row.hover();
    await expect(row.getByRole('button', { name: 'Scroll to previous message' })).toBeVisible();
  }
  for (const segment of ['history']) {
    const row = component.locator(`[data-message-id="${segment}-reply"]`);
    await pressPreviousUserMessage(component, row);
    const target = component.locator(`[data-message-id="${segment}-human"]`);
    await expect
      .poll(async () =>
        Math.abs(
          await target.evaluate(
            (node, container) =>
              node.getBoundingClientRect().top -
              (container as HTMLElement).getBoundingClientRect().top,
            await scroll.elementHandle(),
          ),
        ),
      )
      .toBeLessThanOrEqual(3);
  }
});

test('unloaded human prompt keeps the assistant arrow discoverable', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      historyStartLoaded: false,
      messages: [
        {
          ...historyMessage(
            'wake-tail',
            'user',
            '[WORKSPACE EVENTS] Background work finished',
            900,
          ),
          metadata: { type: 'hook_wake' },
        },
        historyMessage('reply-tail', 'assistant', 'Background update. '.repeat(80), 901),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await source.hover();
  await expect(source.getByRole('button', { name: 'Regenerate response' })).toBeVisible();
  await component.screenshot({ path: testInfo.outputPath('unloaded-human-arrow.png') });
  await expect(source.getByRole('button', { name: 'Previous user message' })).toBeVisible();
});

const automatedTail = [
  {
    ...historyMessage('wake-tail', 'user', '[WORKSPACE EVENTS] Background work finished', 900),
    metadata: { type: 'hook_wake' },
  },
  historyMessage('reply-tail', 'assistant', 'Background update. '.repeat(80), 901),
];
function conversationPage(messages: AgentMessage[], nextToken: string | null = null) {
  return { messages, nextToken, prevToken: 'forward', totalMessages: 1000, truncated: true };
}
async function releasePage(component: Locator) {
  await component.getByTestId('release-page').evaluate((node: HTMLButtonElement) => node.click());
}
async function expectAtMessage(component: Locator, id: string) {
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const target = component.locator(`[data-message-id="${id}"]`);
  await expect(target).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs(
        await target.evaluate(
          (node, container) =>
            node.getBoundingClientRect().top -
            (container as HTMLElement).getBoundingClientRect().top,
          await scroll.elementHandle(),
        ),
      ),
    )
    .toBeLessThanOrEqual(3);
}

for (const retired of [false, true]) {
  test(`unloaded predecessor walks automated pages and lands on the nearest human (retired=${retired})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: {
        messages: automatedTail,
        historyStartLoaded: false,
        retired,
        deferPages: true,
        conversationPages: [
          conversationPage(automatedTail, 'older-1'),
          conversationPage(
            [
              {
                ...historyMessage('older-wake', 'user', 'Monitor wake', 800),
                metadata: { type: 'pr_monitor_wake' },
              },
            ],
            'older-2',
          ),
          conversationPage(
            [
              historyMessage('far-human', 'user', 'Earlier human prompt', 700),
              historyMessage(
                'paged-human',
                'user',
                'Nearest human prompt from unloaded history',
                701,
              ),
              historyMessage('paged-reply', 'assistant', 'Earlier answer. '.repeat(120), 702),
            ],
            'older-3',
          ),
        ],
      },
    });
    const source = component.locator('[data-message-id="reply-tail"]');
    await pressPreviousUserMessage(component, source);
    const busy = source.getByRole('button', { name: 'Finding previous user message…' });
    await expect(busy).toBeDisabled();
    await busy.evaluate((node: HTMLButtonElement) => node.click());
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
    await component.screenshot({ path: testInfo.outputPath('loading-previous-human.png') });
    await releasePage(component);
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail","older-1"]');
    await releasePage(component);
    await expect(component.getByTestId('page-requests')).toHaveText(
      '["reply-tail","older-1","older-2"]',
    );
    await releasePage(component);
    await expectAtMessage(component, 'paged-human');
    await expect(component.locator('[data-message-id="paged-human"]')).toHaveCount(1);
    // The landing replaced the transcript with a detached window.
    await expect(component.getByTestId('chat-history-forward-edge')).toHaveCount(1);
    await expect(component.locator('[data-message-id="reply-tail"]')).toHaveCount(0);
    await page.waitForTimeout(700);
    await expectAtMessage(component, 'paged-human');
    await component
      .getByTestId('append-streaming-message')
      .evaluate((node: HTMLButtonElement) => node.click());
    await page.waitForTimeout(700);
    await expectAtMessage(component, 'paged-human');
    await component.screenshot({ path: testInfo.outputPath('paged-human-settled.png') });
  });
}

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`reading inside a tall paged reply survives quiet spacer resizing (${motion})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.clock.install();
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: {
        messages: automatedTail,
        historyStartLoaded: false,
        conversationPages: [
          conversationPage(automatedTail, 'older-1'),
          conversationPage(
            [
              {
                ...historyMessage('older-wake', 'user', 'Automated only', 800),
                metadata: { type: 'pr_monitor_wake' },
              },
            ],
            'older-2',
          ),
          conversationPage(
            [
              historyMessage('far-human', 'user', 'Earlier human', 700),
              historyMessage('paged-human', 'user', 'Nearest unloaded human', 701),
              historyMessage(
                'paged-reply',
                'assistant',
                'Long answer for reading stability. '.repeat(900),
                702,
              ),
            ],
            'older-3',
          ),
        ],
      },
    });
    const source = component.locator('[data-message-id="reply-tail"]');
    // The wheel below scrolls under the current pointer, so park it on the viewport. The
    // action needs no hover: Enter reaches it while the clock is paused.
    const viewport = component.getByTestId('chat-transcript-scroll-viewport');
    await viewport.hover();
    await pauseClock(page);
    await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
    // Finish navigation while the 400ms spacer reconcile remains pending.
    await page.clock.runFor(300);
    await expectAtMessage(component, 'paged-human');
    const measure = () =>
      viewport.evaluate((node) => {
        const reply = node.querySelector('[data-message-id="paged-reply"]');
        const spacer = node.querySelector('[data-testid="chat-virtual-scrollback-spacer"]');
        const rect = node.getBoundingClientRect();
        const replyRect = reply?.getBoundingClientRect();
        return {
          offset: replyRect ? replyRect.top - rect.top : null,
          spacerHeight: spacer?.getBoundingClientRect().height ?? 0,
          bottom: replyRect ? replyRect.bottom - rect.top : null,
          viewport: node.clientHeight,
          rowStartsInside: [
            ...node.querySelectorAll('[data-message-id], [data-lazy-turn-key]'),
          ].some((row) => {
            const top = row.getBoundingClientRect().top;
            return top >= rect.top && top < rect.bottom;
          }),
        };
      });
    const landed = await measure();
    expect(landed.offset).not.toBeNull();
    // A resend would double the distance this test checks; give one wheel longer.
    await wheelUntilScrolled(viewport, { deltaY: 350, pointer: 'current', attemptTimeout: 5_000 });
    // Native wheel scrolling is asynchronous even while JavaScript time is paused.
    await expect.poll(async () => (await measure()).offset).toBeCloseTo(landed.offset! - 350, 0);
    const before = await measure();
    expect(before.offset).not.toBeNull();
    expect(before.offset!).toBeLessThan(-200);
    expect(before.bottom!).toBeGreaterThan(before.viewport);
    expect(before.rowStartsInside).toBe(false);
    await component.screenshot({ path: testInfo.outputPath('tall-reply-before-resize.png') });
    await page.clock.runFor(850);
    const after = await measure();
    await testInfo.attach('tall-reply-reading-offsets', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    await component.screenshot({ path: testInfo.outputPath('tall-reply-after-resize.png') });
    expect(before.spacerHeight).toBeGreaterThan(0);
    expect(after.spacerHeight).not.toBe(before.spacerHeight);
    expect(after.offset).not.toBeNull();
    expect(Math.abs(after.offset! - before.offset!)).toBeLessThanOrEqual(5);
    await expect(component.getByTestId('page-requests')).toHaveText(
      '["reply-tail","older-1","older-2"]',
    );
  });
}

test('loading failure leaves transcript intact and the arrow retries', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      conversationPages: [
        { error: 'Offline' },
        conversationPage([
          historyMessage('retry-human', 'user', 'Prompt loaded after retry', 899),
          ...automatedTail,
        ]),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await pressPreviousUserMessage(component, source);
  await expect(
    page.getByText('Could not load the previous user message. Please try again.', { exact: true }),
  ).toBeVisible();
  await expect(component.locator('[data-message-id="reply-tail"]')).toHaveCount(1);
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
  await expectAtMessage(component, 'retry-human');
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail","reply-tail"]');
});

test('discard replay preserves pending navigation and the landed reading position', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      discardSnapshot: true,
      deferPages: true,
      totalMessages: automatedTail.length + 5,
      conversationPages: [
        conversationPage([
          historyMessage('replayed-human', 'user', 'Retain this navigation target', 899),
          ...automatedTail,
        ]),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await pressPreviousUserMessage(component, source);
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
  const replay = () =>
    component.getByTestId('replay-discard').evaluate((node: HTMLButtonElement) => node.click());
  await replay();
  await releasePage(component);
  await expectAtMessage(component, 'replayed-human');
  await expect(component.getByTestId('navigation-state')).toContainText('replayed-human');
  await replay();
  // Let the discard effect's next-tick re-anchor and the quiet spacer reconcile run.
  await page.waitForTimeout(500);
  await expectAtMessage(component, 'replayed-human');
  await bottomArrow(component).expectAtBottom(false);
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
  await component
    .getByTestId('discard-transcript')
    .evaluate((node: HTMLButtonElement) => node.click());
  await expect(component.getByTestId('navigation-state')).not.toContainText('replayed-human');
  await bottomArrow(component).expectAtBottom(true);
  await expect
    .poll(() =>
      component
        .getByTestId('chat-transcript-scroll-viewport')
        .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
    )
    .toBeLessThanOrEqual(2);
});

for (const cancel of ['wheel', 'discard', 'newer-navigation'] as const) {
  test(`pending unloaded navigation is cancelled by ${cancel}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: {
        messages: [
          ...automatedTail,
          historyMessage('new-human', 'user', 'A newer human prompt', 902),
          historyMessage('new-reply', 'assistant', 'Latest answer. '.repeat(100), 903),
        ],
        historyStartLoaded: false,
        deferPages: true,
        conversationPages: [
          conversationPage([
            historyMessage('stale-human', 'user', 'Do not install this cancelled page', 899),
            ...automatedTail,
          ]),
        ],
      },
    });
    const source = component.locator('[data-message-id="reply-tail"]');
    await pressPreviousUserMessage(component, source);
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
    if (cancel === 'wheel')
      await component.getByTestId('chat-transcript-scroll-viewport').dispatchEvent('wheel');
    else if (cancel === 'discard')
      await component
        .getByTestId('discard-transcript')
        .evaluate((node: HTMLButtonElement) => node.click());
    else {
      await component
        .locator('[data-message-id="new-reply"]')
        .getByRole('button', { name: 'Previous user message' })
        .press('Enter');
      await expectAtMessage(component, 'new-human');
    }
    await releasePage(component);
    await expect(source.getByRole('button', { name: 'Previous user message' })).toBeEnabled();
    await page.waitForTimeout(350);
    await expect(component.locator('[data-message-id="stale-human"]')).toHaveCount(0);
    if (cancel === 'newer-navigation') await expectAtMessage(component, 'new-human');
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
  });
}

for (const input of ['PageUp', 'PageDown', 'Home', 'End'] as const) {
  test(`pending unloaded navigation yields to actual ${input} input and can retry`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: {
        messages: automatedTail,
        historyStartLoaded: false,
        // One unloaded page keeps real scrolling without invoking the ordinal
        // seek saga, which this focused navigation host does not start.
        totalMessages: automatedTail.length + 5,
        deferPages: true,
        conversationPages: [
          conversationPage([
            historyMessage('stale-human', 'user', 'Cancelled history must never be installed', 899),
            ...automatedTail,
          ]),
          conversationPage([
            historyMessage('retry-human', 'user', 'Prompt from a fresh navigation', 899),
            ...automatedTail,
          ]),
        ],
      },
    });
    const scroll = component.getByTestId('chat-transcript-scroll-viewport');
    const source = component.locator('[data-message-id="reply-tail"]');
    const arrow = source.getByRole('button', { name: 'Previous user message' });
    const state = component.getByTestId('navigation-state');
    await activateHoverAction(arrow, scroll, { requireChange: false });
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
    await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    // Programmatic positioning is not user intent. Start midway so every key can scroll.
    await scroll.evaluate((node) => {
      node.tabIndex = -1;
      node.focus();
      node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
    });
    await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    const before = await scroll.evaluate((node) => node.scrollTop);
    await page.keyboard.press(input);
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).not.toBe(before);
    // Wait out Chromium's keyboard scrolling before measuring the reader position.
    await expectMotionToSettle(scroll);
    const readingOffset = async () =>
      source.evaluate(
        (node, container) =>
          node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
        await scroll.elementHandle(),
      );
    const readerOffset = await readingOffset();
    await expect(state).toHaveText('{"historyIds":[],"busy":false}');
    await expect(arrow).toBeEnabled();
    await releasePage(component);
    await expect(component.getByTestId('page-responses')).toHaveText('1');
    await expect(state).toHaveText('{"historyIds":[],"busy":false}');
    await page.waitForTimeout(350);
    expect(await readingOffset()).toBeCloseTo(readerOffset, 0);
    await expect(component.locator('[data-message-id="stale-human"]')).toHaveCount(0);
    await expect(arrow).toBeEnabled();

    await arrow.press('Enter');
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail","reply-tail"]');
    await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    await releasePage(component);
    await expectAtMessage(component, 'retry-human');
    await expect(state).toContainText('"busy":false');
  });
}

test('pending unloaded navigation preserves editing, controls, and programmatic scroll', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      deferPages: true,
      conversationPages: [
        conversationPage([
          historyMessage('loaded-human', 'user', 'The requested prompt', 899),
          ...automatedTail,
        ]),
      ],
    },
  });
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const source = component.locator('[data-message-id="reply-tail"]');
  const state = component.getByTestId('navigation-state');
  await pressPreviousUserMessage(component, source);
  await expect(state).toHaveText('{"historyIds":[],"busy":true}');

  // Exercise bubbling events from nested editors and interactive content using
  // real keyboard input, without coupling this test to a particular message tool.
  for (const kind of ['input', 'textarea', 'contenteditable', 'button', 'link', 'handled']) {
    await scroll.evaluate((node, kind) => {
      const control = document.createElement(
        kind === 'contenteditable' || kind === 'handled' ? 'div' : kind === 'link' ? 'a' : kind,
      );
      control.dataset.testid = 'nested-control';
      control.tabIndex = 0;
      control.style.cssText = 'position:fixed;top:100px;left:100px;z-index:100;width:180px';
      control.textContent = 'Message control';
      if (kind === 'contenteditable') control.contentEditable = 'true';
      if (kind === 'link') control.setAttribute('href', '#message');
      if (kind === 'handled')
        control.addEventListener('keydown', (event) => event.preventDefault());
      node.appendChild(control);
    }, kind);
    const control = scroll.getByTestId('nested-control');
    await control.click();
    for (const key of ['PageUp', 'PageDown', 'Home', 'End']) {
      await control.press(key);
      await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    }
    await control.evaluate((node) => node.remove());
  }
  const composer = component.locator('.tiptap-editor[contenteditable="true"]');
  await composer.fill('Draft remains editable');
  await composer.press('Home');
  await expect(composer).toHaveText('Draft remains editable');
  await scroll.evaluate((node) => {
    node.tabIndex = -1;
    node.focus();
    node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
  });
  await page.waitForTimeout(100);
  await expect(state).toHaveText('{"historyIds":[],"busy":true}');
  await releasePage(component);
  await expectAtMessage(component, 'loaded-human');
  await expect(state).toContainText('"busy":false');
});

test('unloaded walk reaches confirmed conversation start without a human', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      conversationPages: [
        conversationPage(automatedTail, 'older'),
        conversationPage([
          historyMessage(
            'first-automated',
            'assistant',
            'First autonomous message. '.repeat(100),
            1,
          ),
        ]),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await pressPreviousUserMessage(component, source);
  await expect(component.locator('[data-message-id="first-automated"]')).toBeVisible();
  await expect
    .poll(() =>
      component.getByTestId('chat-transcript-scroll-viewport').evaluate((node) => node.scrollTop),
    )
    .toBe(0);
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail","older"]');
});

test('closing the panel cancels a pending page before remounting the conversation', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      deferPages: true,
      conversationPages: [
        conversationPage([
          historyMessage('stale-human', 'user', 'Do not install after unmount', 899),
          ...automatedTail,
        ]),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await pressPreviousUserMessage(component, source);
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
  await component.getByTestId('toggle-panel').evaluate((node: HTMLButtonElement) => node.click());
  await expect(component.getByTestId('chat-transcript-scroll-viewport')).toHaveCount(0);
  await releasePage(component);
  await component.getByTestId('toggle-panel').evaluate((node: HTMLButtonElement) => node.click());
  await expect(source).toBeVisible();
  await expect(source.getByRole('button', { name: 'Previous user message' })).toBeEnabled();
  await expect(component.locator('[data-message-id="stale-human"]')).toHaveCount(0);
});

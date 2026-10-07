import type { Locator } from '@playwright/experimental-ct-svelte';
import type { AgentMessage } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

// Chromium hides native scrollbars in headless mode unless this default is removed.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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
    async returnToBottom() {
      await expect(command).toBeVisible();
      // Trusted keyboard activation avoids actionability animation frames while
      // the race test's clock is paused, preserving the pending navigation.
      await command.press('Enter');
    },
  };
}

test('newer previous-message navigation wins over a pending return to bottom', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const down = bottomArrow(component);
  await down.expectAtBottom(true);
  for (const current of [24, 23, 22]) {
    const source = component.locator(`[data-message-id="user-${current}"]`);
    await source.hover();
    await source.getByRole('button', { name: 'Scroll to previous message' }).click();
    await page.waitForTimeout(700);
  }

  // Control animation time so the second trusted action always precedes the
  // first animation's completion, even on a slow CI worker.
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1000);
  const forwardStartedAt = await page.evaluate(() => Date.now());
  await down.returnToBottom();
  expect(await page.evaluate(() => Date.now())).toBe(forwardStartedAt);
  await page.clock.runFor(32);
  const pendingBottomDistance = await scroll.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  );
  expect(pendingBottomDistance).toBeGreaterThan(2);
  const targetId = await scroll.evaluate((container) => {
    const viewport = container.getBoundingClientRect();
    const source = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id^="user-"]'),
    ).find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    });
    if (!source) throw new Error('Expected a fully visible user message');
    const action = source.querySelector<HTMLButtonElement>(
      '[aria-label="Scroll to previous message"]',
    );
    if (!action) throw new Error('Expected the previous-message action');
    action.focus({ preventScroll: true });
    return `user-${Number(source.dataset.messageId!.slice(5)) - 1}`;
  });
  await page.keyboard.press('Enter');
  await page.clock.runFor(800);
  await expect(page.getByTestId('chat-scroll-to-bottom-button')).toHaveCount(0);
  const target = component.locator(`[data-message-id="${targetId}"]`);
  const offset = await target.evaluate(
    (node, container) =>
      node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
    await scroll.elementHandle(),
  );
  await testInfo.attach('overlapping-navigation', {
    body: JSON.stringify({
      targetId,
      offset,
      forwardStartedAt,
      pendingBottomDistance,
      scrollTop: await scroll.evaluate((node) => node.scrollTop),
    }),
    contentType: 'application/json',
  });
  expect(Math.abs(offset)).toBeLessThanOrEqual(3);
  await down.expectAtBottom(false);
  await component.screenshot({ path: testInfo.outputPath('overlapping-navigation-settled.png') });

  // Reverse the order while the lazy lookup is awaiting its first frame:
  // the newer return-to-bottom action must supersede that pending navigation.
  const reverseStartedAt = await page.evaluate(() => Date.now());
  await target
    .getByRole('button', { name: 'Scroll to previous message' })
    .evaluate((node: HTMLButtonElement) => node.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await down.returnToBottom();
  // Activating the floating arrow must not advance the pending lookup's frame.
  const reverseSelectedAt = await page.evaluate(() => Date.now());
  expect(reverseSelectedAt).toBe(reverseStartedAt);
  await page.clock.runFor(800);
  await down.expectAtBottom(true);
  const bottomDistance = await scroll.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  );
  expect(bottomDistance).toBeLessThanOrEqual(2);
  await testInfo.attach('overlapping-navigation-reversed', {
    body: JSON.stringify({ reverseStartedAt, reverseSelectedAt, bottomDistance }),
    contentType: 'application/json',
  });
  await page.clock.resume();
  await expect(page.getByTestId('chat-scroll-to-bottom-button')).toHaveCount(0);
  await component.screenshot({ path: testInfo.outputPath('return-to-bottom-settled.png') });
});

test('previous-message action leaves bottom and stays at successive user messages', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.locator('.conversation-column').locator('..');
  const down = bottomArrow(component);
  await down.expectAtBottom(true);

  for (const current of [24, 23, 22]) {
    const source = component.locator(`[data-message-id="user-${current}"]`);
    await source.hover();
    await source.getByRole('button', { name: 'Scroll to previous message' }).click();
    // Observe the settled destination, including animation, focus, lazy layout,
    // and follow-bottom observers; a transient crossing is not success.
    await page.waitForTimeout(700);
    const target = component.locator(`[data-message-id="user-${current - 1}"]`);
    const offset = await target.evaluate(
      (node, container) =>
        node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
      await scroll.elementHandle(),
    );
    const position = await scroll.evaluate((node) => ({
      scrollTop: node.scrollTop,
      bottomDistance: node.scrollHeight - node.clientHeight - node.scrollTop,
    }));
    await testInfo.attach(`previous-${current - 1}`, {
      body: JSON.stringify({ offset, ...position }),
      contentType: 'application/json',
    });
    expect(Math.abs(offset)).toBeLessThanOrEqual(3);
    expect(position.bottomDistance).toBeGreaterThan(2);
  }
  const readingPosition = await scroll.evaluate((node) => node.scrollTop);
  await component
    .getByTestId('append-streaming-message')
    .evaluate((node: HTMLButtonElement) => node.click());
  await page.waitForTimeout(700);
  const positionAfterStreaming = await scroll.evaluate((node) => node.scrollTop);
  expect(positionAfterStreaming).toBeCloseTo(readingPosition, 0);
  await testInfo.attach('streaming-reading-position', {
    body: JSON.stringify({ readingPosition, positionAfterStreaming }),
    contentType: 'application/json',
  });
  await component.screenshot({ path: testInfo.outputPath('previous-message-settled.png') });
  await down.returnToBottom();
  await down.expectAtBottom(true);
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
});

test('previous-message navigation tracks a preceding row collapsing during animation', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  await bottomArrow(component).expectAtBottom(true);
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1000);
  const target = component.locator('[data-message-id="user-23"]');
  // Model an overestimated preceding lazy row becoming measured content.
  await target.evaluate((node) => {
    const spacer = document.createElement('div');
    spacer.dataset.testid = 'collapsing-preceding-row';
    spacer.style.height = '112px';
    node.before(spacer);
  });
  await page.clock.runFor(32);
  await component
    .locator('[data-message-id="user-24"]')
    .getByRole('button', { name: 'Scroll to previous message' })
    .evaluate((node: HTMLButtonElement) => node.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await page.clock.runFor(32);
  await component.getByTestId('collapsing-preceding-row').evaluate((node) => node.remove());
  await page.clock.runFor(800);
  const offset = await target.evaluate(
    (node, container) =>
      node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
    await scroll.elementHandle(),
  );
  const bottomDistance = await scroll.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  );
  await testInfo.attach('collapsed-predecessor-navigation', {
    body: JSON.stringify({ offset, bottomDistance }),
    contentType: 'application/json',
  });
  expect(Math.abs(offset)).toBeLessThanOrEqual(3);
  expect(bottomDistance).toBeGreaterThan(2);
  await page.clock.resume();
});

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
      await source.hover();
      await source
        .getByRole('button', {
          name: sourceRole === 'assistant' ? 'Previous user message' : 'Scroll to previous message',
        })
        .press('Enter');
      await page.waitForTimeout(700);
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
      await first.hover();
      await first.getByRole('button', { name: 'Scroll to previous message' }).click();
      await page.waitForTimeout(700);
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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
  await expect(component.getByTestId('chat-history-gap')).toHaveCount(1);
  for (const id of ['history-orphan', 'live-orphan']) {
    const row = component.locator(`[data-message-id="${id}"]`);
    await row.hover();
    await expect(row.getByRole('button', { name: 'Previous user message' })).toBeVisible();
  }
  for (const id of ['history-human', 'live-human']) {
    const row = component.locator(`[data-message-id="${id}"]`);
    await row.hover();
    await expect(row.getByRole('button', { name: 'Scroll to previous message' })).toBeVisible();
  }
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  for (const segment of ['history', 'live']) {
    const row = component.locator(`[data-message-id="${segment}-reply"]`);
    await row.hover();
    await row.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
    await source.hover();
    await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
    await expect(component.getByTestId('chat-history-gap')).toHaveCount(1);
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
    await source.hover();
    await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
    await expectAtMessage(component, 'paged-human');
    const viewport = component.getByTestId('chat-transcript-scroll-viewport');
    await viewport.hover();
    await page.mouse.wheel(0, 350);
    // Enter the middle of a reply before the 400ms quiet spacer reconcile.
    await page.waitForTimeout(100);
    const measure = () =>
      viewport.evaluate((node) => {
        const reply = node.querySelector('[data-message-id="paged-reply"]');
        const rect = node.getBoundingClientRect();
        const replyRect = reply?.getBoundingClientRect();
        return {
          offset: replyRect ? replyRect.top - rect.top : null,
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
    const before = await measure();
    expect(before.offset).not.toBeNull();
    expect(before.offset!).toBeLessThan(-200);
    expect(before.bottom!).toBeGreaterThan(before.viewport);
    expect(before.rowStartsInside).toBe(false);
    await component.screenshot({ path: testInfo.outputPath('tall-reply-before-resize.png') });
    await page.waitForTimeout(850);
    const after = await measure();
    await testInfo.attach('tall-reply-reading-offsets', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    await component.screenshot({ path: testInfo.outputPath('tall-reply-after-resize.png') });
    expect(after.offset).not.toBeNull();
    expect(Math.abs(after.offset! - before.offset!)).toBeLessThanOrEqual(5);
    await expect(component.getByTestId('page-requests')).toHaveText(
      '["reply-tail","older-1","older-2"]',
    );
  });
}

test('unloaded gap resolves the nearer human instead of crossing to the loaded older prompt', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatMessageNavigatorIntegrationHost, {
    props: {
      messages: automatedTail,
      historyStartLoaded: false,
      historyGap: true,
      historyMessages: [historyMessage('wrong-human', 'user', 'Too far back across a gap', 1)],
      conversationPages: [
        conversationPage(
          [
            historyMessage('gap-human', 'user', 'Correct human inside the unloaded gap', 899),
            ...automatedTail,
          ],
          'older',
        ),
      ],
    },
  });
  const source = component.locator('[data-message-id="reply-tail"]');
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
  await component.getByTestId('settle-gap').evaluate((node: HTMLButtonElement) => node.click());
  await expectAtMessage(component, 'gap-human');
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
});

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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
    await source.hover();
    await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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

for (const input of ['PageUp', 'PageDown', 'Home', 'End', 'scrollbar'] as const) {
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
    await source.hover();
    await arrow.press('Enter');
    await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
    await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    // Programmatic positioning is not user intent. Start midway so every key
    // and the native scrollbar thumb drag can actually move the viewport.
    await scroll.evaluate((node) => {
      node.tabIndex = -1;
      node.focus();
      node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
    });
    await expect(state).toHaveText('{"historyIds":[],"busy":true}');
    const before = await scroll.evaluate((node) => node.scrollTop);
    if (input === 'scrollbar') {
      const geometry = await scroll.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.right - (node.offsetWidth - node.clientWidth) / 2,
          y: rect.top + rect.height / 2,
          gutter: node.offsetWidth - node.clientWidth,
        };
      });
      expect(geometry.gutter).toBeGreaterThan(0);
      await page.mouse.move(geometry.x, geometry.y);
      await page.mouse.down();
      await page.mouse.move(geometry.x, geometry.y + 90, { steps: 6 });
      await page.mouse.up();
    } else {
      await page.keyboard.press(input);
    }
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).not.toBe(before);
    // Wait out Chromium's keyboard scrolling before measuring the reader position.
    await page.waitForTimeout(350);
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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
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
  await source.hover();
  await source.getByRole('button', { name: 'Previous user message' }).press('Enter');
  await expect(component.getByTestId('page-requests')).toHaveText('["reply-tail"]');
  await component.getByTestId('toggle-panel').evaluate((node: HTMLButtonElement) => node.click());
  await expect(component.getByTestId('chat-transcript-scroll-viewport')).toHaveCount(0);
  await releasePage(component);
  await component.getByTestId('toggle-panel').evaluate((node: HTMLButtonElement) => node.click());
  await expect(source).toBeVisible();
  await source.hover();
  await expect(source.getByRole('button', { name: 'Previous user message' })).toBeEnabled();
  await expect(component.locator('[data-message-id="stale-human"]')).toHaveCount(0);
});

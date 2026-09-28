import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import type { AgentMessage } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

function bottomMenu(component: Locator, page: Page) {
  const trigger = component
    .locator('[data-panel-content-header]')
    .getByTestId('panel-actions-trigger');
  const command = page.getByTestId('chat-scroll-to-bottom-button');

  async function open() {
    // Keyboard activation avoids actionability animation frames while the race
    // test's clock is paused. These remain trusted browser input events.
    await trigger.press('Enter');
    await expect(command).toBeVisible();
  }

  return {
    async expectAtBottom(atBottom: boolean) {
      await open();
      if (atBottom) {
        await expect(command).toHaveAttribute('aria-disabled', 'true');
      } else {
        await expect(command).not.toHaveAttribute('aria-disabled', 'true');
      }
      await command.press('Escape');
      await expect(command).toHaveCount(0);
    },
    async returnToBottom() {
      await open();
      await expect(command).not.toHaveAttribute('aria-disabled', 'true');
      await command.press('Enter');
      await expect(command).toHaveCount(0);
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
  const down = bottomMenu(component, page);
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
  // Opening and selecting the lazy menu must not advance the pending lookup's frame.
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
  await component.screenshot({ path: testInfo.outputPath('return-to-bottom-settled.png') });
  await page.clock.resume();
});

test('previous-message action leaves bottom and stays at successive user messages', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.locator('.conversation-column').locator('..');
  const down = bottomMenu(component, page);
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
    await testInfo.attach(`previous-${current - 1}`, {
      body: JSON.stringify({ offset, scrollTop: await scroll.evaluate((node) => node.scrollTop) }),
      contentType: 'application/json',
    });
    expect(Math.abs(offset)).toBeLessThanOrEqual(3);
    await down.expectAtBottom(false);
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

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`previous-message action skips automated turns and reaches a lazy first message with ${reducedMotion} motion`, async ({
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
      message('first', 'user', 'First authored prompt'),
      message('response-first', 'assistant', 'Long earlier response. '.repeat(600)),
      ...Array.from({ length: 22 }, (_, index) => [
        message(`automated-${index}`, 'user', '[TASK WAKE] A background update', {
          type: 'task_wake',
        }),
        message(`response-automated-${index}`, 'assistant', 'Background response. '.repeat(14)),
      ]).flat(),
      message('last', 'user', 'Last authored prompt'),
      message('response-last', 'assistant', 'Latest response. '.repeat(14)),
    ];
    const component = await mount(ChatMessageNavigatorIntegrationHost, { props: { messages } });
    const scroll = component.getByTestId('chat-transcript-scroll-viewport');
    const down = bottomMenu(component, page);
    await down.expectAtBottom(true);
    const first = component.locator('[data-message-id="first"]');
    await expect(first.locator('[data-lazy-visible]')).toHaveAttribute(
      'data-lazy-visible',
      'false',
    );
    const last = component.locator('[data-message-id="last"]');
    await last.hover();
    await last.getByRole('button', { name: 'Scroll to previous message' }).press('Enter');
    await page.waitForTimeout(700);
    await expect(first).toContainText('First authored prompt');
    const offset = await first.evaluate(
      (node, container) =>
        node.getBoundingClientRect().top - (container as HTMLElement).getBoundingClientRect().top,
      await scroll.elementHandle(),
    );
    expect(Math.abs(offset)).toBeLessThanOrEqual(3);
    await down.expectAtBottom(false);
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

test('keyboard message navigation releases follow and can return to bottom', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const down = bottomMenu(component, page);
  await down.expectAtBottom(true);
  const bottom = await scroll.evaluate((node) => node.scrollTop);
  for (let step = 0; step < 3; step++) {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('navigate-message', { detail: { direction: 'previous' } }),
      ),
    );
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  const readingPosition = await scroll.evaluate((node) => node.scrollTop);
  expect(readingPosition).toBeLessThan(bottom - 20);
  for (let step = 0; step < 3; step++) {
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

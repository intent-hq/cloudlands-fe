import type { AgentMessage } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

test('previous-message action leaves bottom and stays at successive user messages', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.locator('.conversation-column').locator('..');
  const down = component
    .locator('[data-panel-content-header]')
    .getByTestId('chat-scroll-to-bottom-button');
  await expect(down).toBeDisabled();

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
    await expect(down).toBeEnabled();
  }
  const readingPosition = await scroll.evaluate((node) => node.scrollTop);
  await component
    .getByTestId('append-streaming-message')
    .evaluate((node: HTMLButtonElement) => node.click());
  await page.waitForTimeout(700);
  expect(await scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0);
  await component.screenshot({ path: testInfo.outputPath('previous-message-settled.png') });
  await down.click();
  await expect(down).toBeDisabled();
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
    const header = component.locator('[data-panel-content-header]');
    const down = header.getByTestId('chat-scroll-to-bottom-button');
    await expect(down).toBeDisabled();
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
    await expect(down).toBeEnabled();
    await first.hover();
    await first.getByRole('button', { name: 'Scroll to previous message' }).click();
    await page.waitForTimeout(700);
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
    await component.screenshot({ path: testInfo.outputPath('first-message-fallback.png') });
  });
}

test('keyboard message navigation releases follow and can return to bottom', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatMessageNavigatorIntegrationHost);
  const scroll = component.getByTestId('chat-transcript-scroll-viewport');
  const down = component
    .locator('[data-panel-content-header]')
    .getByTestId('chat-scroll-to-bottom-button');
  await expect(down).toBeDisabled();
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
  expect(await scroll.evaluate((node) => node.scrollTop)).toBeLessThan(bottom - 20);
  for (let step = 0; step < 3; step++) {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('navigate-message', { detail: { direction: 'next' } })),
    );
    await page.waitForTimeout(200);
  }
  await expect(down).toBeDisabled();
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
});

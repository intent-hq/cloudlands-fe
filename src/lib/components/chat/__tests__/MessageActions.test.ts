/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime, formatFullDateTime, formatTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import MessageActions from '../MessageActions.svelte';

describe('MessageActions callbacks', () => {
  it('keeps role-specific action order and invokes each callback exactly once', async () => {
    const userCallbacks = [vi.fn(), vi.fn(), vi.fn()];
    const user = render(MessageActions, {
      props: {
        role: 'user',
        onEdit: userCallbacks[0],
        onCopy: userCallbacks[1],
        onScrollToPrevious: userCallbacks[2],
      },
    });
    const userButtons = user.getAllByRole('button');
    expect(userButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      m.chat_messageActions_editMessage_ariaLabel(),
      m.chat_messageActions_copyMessage_ariaLabel(),
      m.chat_messageActions_scrollToPrevious_label(),
    ]);
    for (const button of userButtons) await fireEvent.click(button);
    for (const callback of userCallbacks) expect(callback).toHaveBeenCalledTimes(1);
    user.unmount();

    const onRegenerate = vi.fn();
    const onFork = vi.fn();
    const onVote = vi.fn();
    const onCopy = vi.fn();
    const assistant = render(MessageActions, {
      props: { role: 'assistant', onRegenerate, onFork, onVote, onCopy },
    });
    const assistantButtons = assistant.getAllByRole('button');
    expect(assistantButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      m.chat_messageActions_regenerate_ariaLabel(),
      m.chat_messageActions_fork_ariaLabel(),
      m.chat_messageActions_goodResponse_label(),
      m.chat_messageActions_badResponse_label(),
      m.chat_messageActions_copyMessage_ariaLabel(),
    ]);
    for (const button of assistantButtons) await fireEvent.click(button);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onFork).toHaveBeenCalledTimes(1);
    expect(onVote.mock.calls).toEqual([['up'], ['down']]);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('reflects confirmed vote state without prematurely changing it on activation', async () => {
    const onVote = vi.fn();
    const view = render(MessageActions, {
      props: { role: 'assistant', currentVote: 'up', onVote },
    });
    const good = screen.getByRole('button', { name: m.chat_messageActions_goodResponse_label() });
    const bad = screen.getByRole('button', { name: m.chat_messageActions_badResponse_label() });
    expect(good.getAttribute('aria-pressed')).toBe('true');
    expect(bad.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(bad);
    expect(onVote).toHaveBeenCalledExactlyOnceWith('down');
    expect(good.getAttribute('aria-pressed')).toBe('true');
    await view.rerender({ role: 'assistant', currentVote: 'down', onVote });
    expect(good.getAttribute('aria-pressed')).toBe('false');
    expect(bad.getAttribute('aria-pressed')).toBe('true');
  });

  it('forwards modifier keys through declarative copy actions', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onCopy = vi.fn();
    render(MessageActions, {
      props: { role: 'assistant', onCopy, requestId: 'request-42' },
    });
    const copy = screen.getByRole('button', {
      name: m.chat_messageActions_copyMessage_ariaLabel(),
    });

    await fireEvent.click(copy, { shiftKey: true });
    expect(writeText).toHaveBeenCalledWith('request-42');
    expect(onCopy).not.toHaveBeenCalled();

    await fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledTimes(1);
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else delete (navigator as { clipboard?: Clipboard }).clipboard;
  });
});

describe('MessageActions timestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 5, 3, 0, 5));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('prefers canonical timestamp and exposes localized compact/full machine-readable time', () => {
    const timestamp = new Date(2026, 5, 3, 0, 1, 20);
    const fallback = new Date('2025-01-01T01:02:03.000Z');
    const { container } = render(MessageActions, {
      props: { role: 'user', timestamp, createdAt: fallback, onCopy: vi.fn() },
    });
    const time = container.querySelector('time')!;
    expect(time.textContent).toBe(formatTime(timestamp));
    expect(time.getAttribute('datetime')).toBe(timestamp.toISOString());
    expect(time.getAttribute('title')).toBe(formatFullDateTime(timestamp));
    expect(time.getAttribute('aria-label')).toBe(formatFullDateTime(timestamp));
  });

  describe.each(['user', 'assistant'] as const)('%s messages', (role) => {
    it.each([
      ['year boundary', new Date(2026, 11, 31, 23, 59, 50)],
      ['spring DST boundary', new Date(2026, 2, 7, 23, 59, 50)],
      ['autumn DST boundary', new Date(2026, 9, 31, 23, 59, 50)],
    ])('updates mounted timestamps across the %s', async (_label, now) => {
      vi.setSystemTime(now);
      const timestamp = new Date(now.getTime() - 60_000);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const { container } = render(MessageActions, { props: { role, timestamp } });
      const time = container.querySelector('time')!;
      const future = render(MessageActions, { props: { role, timestamp: tomorrow } });
      const futureTime = future.container.querySelector('time')!;
      expect(time.textContent).toBe(formatTime(timestamp));
      expect(futureTime.textContent).toBe(formatDateTime(tomorrow));

      await vi.advanceTimersByTimeAsync(10_000);
      await tick();
      expect(time.textContent).toBe(formatDateTime(timestamp));
      expect(time.getAttribute('datetime')).toBe(timestamp.toISOString());

      // A future date becomes today, then ages out on the next (possibly DST) day.
      expect(futureTime.textContent).toBe(formatTime(tomorrow));
      const nextMidnight = new Date(tomorrow);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      await vi.advanceTimersByTimeAsync(nextMidnight.getTime() - tomorrow.getTime());
      await tick();
      expect(futureTime.textContent).toBe(formatDateTime(tomorrow));
    });

    it.each(['focus', 'visibilitychange'])('refreshes on %s after sleep', async (eventName) => {
      const timestamp = new Date();
      const { container } = render(MessageActions, { props: { role, timestamp } });
      const time = container.querySelector('time')!;
      expect(time.textContent).toBe(formatTime(timestamp));

      vi.setSystemTime(new Date(2026, 5, 4, 8));
      const target = eventName === 'focus' ? window : document;
      target.dispatchEvent(new Event(eventName));
      await tick();
      expect(time.textContent).toBe(formatDateTime(timestamp));
    });

    it('shows only the time for the current local calendar day', () => {
      const timestamp = new Date(2026, 5, 3, 0, 1).toISOString();
      const { container } = render(MessageActions, { props: { role, timestamp } });

      expect(container.querySelector('time')?.textContent).toBe(formatTime(timestamp));
    });

    it.each([
      ['yesterday, less than 24 hours ago', new Date(2026, 5, 2, 23, 55)],
      ['the same day of a different month', new Date(2026, 4, 3, 19)],
      ['the same month and day of a different year', new Date(2025, 5, 3, 19)],
      ['a future day', new Date(2026, 5, 4, 19)],
    ])('shows the date and time for %s', (_description, timestamp) => {
      const { container } = render(MessageActions, {
        props: { role, timestamp: timestamp.toISOString() },
      });
      const time = container.querySelector('time')!;

      expect(time.textContent).toBe(formatDateTime(timestamp));
      expect(time.getAttribute('datetime')).toBe(timestamp.toISOString());
      expect(time.getAttribute('aria-label')).toBe(formatFullDateTime(timestamp));
    });
  });

  it('cleans up its midnight timer and wake listeners on unmount', async () => {
    const timerCount = vi.getTimerCount();
    const { unmount } = render(MessageActions, { props: { role: 'user', timestamp: new Date() } });
    expect(vi.getTimerCount()).toBeGreaterThan(timerCount);
    unmount();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(vi.getTimerCount()).toBe(timerCount);
  });

  it('uses createdAt only when timestamp is missing or invalid', () => {
    const fallback = new Date(2026, 5, 2, 19);
    for (const timestamp of [undefined, 'not-a-date']) {
      const { container, unmount } = render(MessageActions, {
        props: { role: 'assistant', timestamp, createdAt: fallback, onCopy: vi.fn() },
      });
      expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
        fallback.toISOString(),
      );
      expect(container.querySelector('time')?.textContent).toBe(formatDateTime(fallback));
      unmount();
    }
  });

  it('omits invalid or missing timestamps without an empty element or leading gap', () => {
    const { container } = render(MessageActions, {
      props: { role: 'user', timestamp: 'bad', createdAt: '', onCopy: vi.fn() },
    });
    const pill = screen.getByTestId('message-actions');
    expect(container.querySelector('time')).toBeNull();
    expect(pill.textContent?.trim()).toBe('');
    expect(pill.querySelectorAll('[data-slot="button"]')).toHaveLength(1);
  });
});

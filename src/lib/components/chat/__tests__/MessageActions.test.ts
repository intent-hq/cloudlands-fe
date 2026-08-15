/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatFullDateTime, formatTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import MessageActions from '../MessageActions.svelte';
import {
  MESSAGE_ACTION_REVEAL_CLASS,
  MESSAGE_ACTION_SURFACE_CLASS,
} from '../message-action-surface';

let geometryStyles: HTMLStyleElement;

beforeAll(() => {
  geometryStyles = document.createElement('style');
  geometryStyles.textContent = `
    .message-actions { box-sizing: border-box; }
    .flex { display: flex; }
    .items-center { align-items: center; }
    .gap-0\\.5 { gap: 2px; }
    .rounded-md { border-radius: 6px; }
    .border { border-style: solid; border-width: 1px; }
    .border-border { border-color: rgb(90, 90, 90); }
    .bg-sidebar\\/95 { background-color: rgba(30, 30, 30, 0.95); }
    .p-0 { padding: 0; }
    .absolute { position: absolute; }
    .geometry-host { box-sizing: border-box; height: 80px; position: relative; width: 240px; }
    .message-actions [data-slot='button'] { height: 28px; width: 28px; }
    .message-actions time { width: 48px; }
  `;
  document.head.append(geometryStyles);
});

afterAll(() => geometryStyles.remove());

describe('MessageActions shared surface', () => {
  it('mounts identical user and assistant surface/icon styles from one contract', () => {
    const user = render(MessageActions, { props: { role: 'user', onCopy: vi.fn() } });
    const assistant = render(MessageActions, {
      props: { role: 'assistant', onCopy: vi.fn() },
    });
    const userPill = user.container.querySelector<HTMLElement>('[data-testid="message-actions"]')!;
    const assistantPill = assistant.container.querySelector<HTMLElement>(
      '[data-testid="message-actions"]',
    )!;

    for (const token of MESSAGE_ACTION_SURFACE_CLASS.split(' ')) {
      expect(userPill.classList.contains(token)).toBe(true);
      expect(assistantPill.classList.contains(token)).toBe(true);
    }
    for (const token of MESSAGE_ACTION_REVEAL_CLASS.split(' ')) {
      expect(userPill.classList.contains(token)).toBe(true);
      expect(assistantPill.classList.contains(token)).toBe(true);
    }

    const userStyle = getComputedStyle(userPill);
    const assistantStyle = getComputedStyle(assistantPill);
    expect({
      background: userStyle.backgroundColor,
      border: userStyle.borderWidth,
      radius: userStyle.borderRadius,
      gap: userStyle.gap,
      padding: userStyle.padding,
    }).toEqual({
      background: assistantStyle.backgroundColor,
      border: assistantStyle.borderWidth,
      radius: assistantStyle.borderRadius,
      gap: assistantStyle.gap,
      padding: assistantStyle.padding,
    });
    expect(userStyle.borderWidth).toBe('1px');
    expect(userStyle.borderRadius).toBe('6px');
    expect(userStyle.gap).toBe('2px');

    const buttons = [
      user.container.querySelector<HTMLButtonElement>('[data-slot="button"]')!,
      assistant.container.querySelector<HTMLButtonElement>('[data-slot="button"]')!,
    ];
    for (const button of buttons) {
      expect(getComputedStyle(button).width).toBe('28px');
      expect(getComputedStyle(button).height).toBe('28px');
    }
  });

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
});

describe('MessageActions timestamp', () => {
  it('prefers canonical timestamp and exposes localized compact/full machine-readable time', () => {
    const timestamp = new Date('2026-06-02T14:35:20.000Z');
    const fallback = new Date('2025-01-01T01:02:03.000Z');
    const { container } = render(MessageActions, {
      props: { role: 'user', timestamp, createdAt: fallback, onCopy: vi.fn() },
    });
    const time = container.querySelector('time')!;
    expect(time.textContent).toBe(formatTime(timestamp));
    expect(time.getAttribute('datetime')).toBe(timestamp.toISOString());
    expect(time.getAttribute('title')).toBe(formatFullDateTime(timestamp));
    expect(time.getAttribute('aria-label')).toBe(formatFullDateTime(timestamp));
    expect(time.className).toContain('pointer-events-none');
  });

  it('uses createdAt only when timestamp is missing or invalid', () => {
    const fallback = new Date('2026-06-03T09:10:11.000Z');
    for (const timestamp of [undefined, 'not-a-date']) {
      const { container, unmount } = render(MessageActions, {
        props: { role: 'assistant', timestamp, createdAt: fallback, onCopy: vi.fn() },
      });
      expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
        fallback.toISOString(),
      );
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

describe('MessageActions geometry and focus', () => {
  it('stays an absolute zero-reflow overlay with narrow/200% zoom containment', async () => {
    const host = document.createElement('div');
    host.className = 'geometry-host';
    document.body.append(host);
    const rendered = render(MessageActions, {
      target: host,
      props: {
        role: 'assistant',
        class: 'absolute bottom-0 right-0 z-10',
        timestamp: '2026-06-02T14:35:20.000Z',
        onRegenerate: vi.fn(),
        onFork: vi.fn(),
        onVote: vi.fn(),
        onCopy: vi.fn(),
      },
    });
    const pill = rendered.getByTestId('message-actions');
    const beforeHeight = getComputedStyle(host).height;
    const style = getComputedStyle(pill);
    expect(style.position).toBe('absolute');

    const buttonWidth = 28;
    const timeWidth = 48;
    const gap = 2;
    const border = 2;
    const cssWidth = timeWidth + 5 * buttonWidth + 5 * gap + border;
    expect(cssWidth).toBeLessThanOrEqual(240);
    expect(cssWidth * 2).toBeLessThanOrEqual(480);

    const firstButton = rendered.getAllByRole('button')[0];
    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);
    expect(pill.className).toContain('group-focus-within:opacity-100');
    expect(getComputedStyle(host).height).toBe(beforeHeight);
    expect(pill.querySelector('time')?.className).toContain('pointer-events-none');
    rendered.unmount();
    host.remove();
  });
});

/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({ subscribe: (run: (value: string) => void) => (run('ws-1'), () => {}) }),
    { select: () => 'ws-1' },
  ),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({ subscribe: (run: (value: unknown[]) => void) => (run([]), () => {}) }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({ subscribe: (run: (value: undefined) => void) => (run(undefined), () => {}) }),
    { select: () => undefined },
  ),
  selectAgentSession: Object.assign(
    () => ({ subscribe: (run: (value: undefined) => void) => (run(undefined), () => {}) }),
    { select: () => undefined },
  ),
}));

vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

type LegacyMessage = AgentMessage & { createdAt?: Date | string };

function message(
  role: 'user' | 'assistant',
  timestamp: Date | string,
  createdAt?: Date | string,
): LegacyMessage {
  return {
    id: `${role}-message`,
    role,
    timestamp,
    createdAt,
    contentBlocks: [{ type: 'text', text: `${role} content` }],
  };
}

describe('ChatMessage action overlays', () => {
  it('routes assistant navigation independently from regeneration', async () => {
    const onScrollToPrevious = vi.fn();
    const onRegenerate = vi.fn();
    render(ChatMessage, {
      props: {
        message: message('assistant', '2026-09-29T06:00:00.000Z'),
        onScrollToPrevious,
        onRegenerate,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Previous user message' }));
    expect(onScrollToPrevious).toHaveBeenCalledExactlyOnceWith();
    expect(onRegenerate).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }));
    expect(onRegenerate).toHaveBeenCalledExactlyOnceWith();
    expect(onScrollToPrevious).toHaveBeenCalledTimes(1);
  });

  it('keeps one canonical identity when an outer transcript row owns it', () => {
    const standalone = render(ChatMessage, {
      props: { message: message('user', '2026-06-02T14:35:20.000Z') },
    });
    expect(
      standalone.container.querySelectorAll(
        '[data-message-id="user-message"][data-message-role="user"]',
      ),
    ).toHaveLength(1);
    standalone.unmount();

    const outerRow = document.createElement('div');
    outerRow.dataset.messageId = 'user-message';
    outerRow.dataset.messageRole = 'user';
    document.body.append(outerRow);
    const nested = render(ChatMessage, {
      target: outerRow,
      props: {
        message: message('user', '2026-06-02T14:35:20.000Z'),
        ownsMessageIdentity: false,
      },
    });

    try {
      expect(
        document.querySelectorAll('[data-message-id="user-message"][data-message-role="user"]'),
      ).toHaveLength(1);
      expect(nested.container.querySelector('[data-message-id], [data-message-role]')).toBeNull();
    } finally {
      nested.unmount();
      outerRow.remove();
    }
  });

  it('prefers the canonical user timestamp over createdAt', () => {
    const timestamp = new Date('2026-06-02T14:35:20.000Z');
    const createdAt = new Date('2025-01-01T01:02:03.000Z');
    const { container } = render(ChatMessage, {
      props: { message: message('user', timestamp, createdAt), onScrollToPrevious: vi.fn() },
    });
    const pill = screen.getByTestId('message-actions');
    expect(pill.getAttribute('data-message-actions-role')).toBe('user');
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(timestamp.toISOString());
    expect(pill.parentElement?.getAttribute('data-testid')).toBe('user-message-surface');
  });

  it('uses createdAt when the assistant timestamp is invalid', () => {
    const createdAt = new Date('2026-06-03T09:10:11.000Z');
    const { container } = render(ChatMessage, {
      props: { message: message('assistant', 'invalid', createdAt), onRegenerate: vi.fn() },
    });
    const pill = screen.getByTestId('message-actions');
    expect(pill.getAttribute('data-message-actions-role')).toBe('assistant');
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(createdAt.toISOString());
    expect(pill.closest('[data-message-role]')?.getAttribute('data-message-role')).toBe(
      'assistant',
    );
  });

  it('suppresses assistant actions while streaming and leaves user invalid time gap-free', () => {
    const assistant = render(ChatMessage, {
      props: { message: message('assistant', '2026-06-02T14:35:20.000Z'), isStreaming: true },
    });
    expect(assistant.queryByTestId('message-actions')).toBeNull();
    assistant.unmount();

    const user = render(ChatMessage, {
      props: { message: message('user', 'invalid', 'also-invalid') },
    });
    expect(user.getByTestId('message-actions').querySelector('time')).toBeNull();
  });
});

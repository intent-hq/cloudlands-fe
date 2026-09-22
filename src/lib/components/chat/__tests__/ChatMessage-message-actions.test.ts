/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

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

  it('affirms message actions and timestamps in every required visual state', async () => {
    const timestamp = new Date('2026-06-02T14:35:20.000Z');
    const observed = await exerciseVisualStates(() => {
      const view = render(ChatMessage, {
        props: { message: message('user', timestamp), onScrollToPrevious: vi.fn() },
      });
      const surface = view.getByTestId('user-message-surface');
      surface.tabIndex = 0;
      return {
        ...view,
        target: surface,
        assertCapability: () => {
          expect(view.getByTestId('message-actions')).toBeTruthy();
          expect(view.container.querySelector('time')?.getAttribute('datetime')).toBe(
            timestamp.toISOString(),
          );
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('wires the canonical user timestamp into the shared top-right overlay', () => {
    const timestamp = new Date('2026-06-02T14:35:20.000Z');
    const createdAt = new Date('2025-01-01T01:02:03.000Z');
    const { container } = render(ChatMessage, {
      props: { message: message('user', timestamp, createdAt), onScrollToPrevious: vi.fn() },
    });
    const pill = screen.getByTestId('message-actions');
    expect(pill.getAttribute('data-message-actions-role')).toBe('user');
    expect(pill.className).toContain('absolute');
    expect(pill.className).toContain('right-1');
    expect(pill.className).toContain('top-1');
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(timestamp.toISOString());
    expect(pill.parentElement?.getAttribute('data-testid')).toBe('user-message-surface');
  });

  it('uses safe createdAt fallback in the shared assistant bottom-right overlay', () => {
    const createdAt = new Date('2026-06-03T09:10:11.000Z');
    const { container } = render(ChatMessage, {
      props: { message: message('assistant', 'invalid', createdAt), onRegenerate: vi.fn() },
    });
    const pill = screen.getByTestId('message-actions');
    expect(pill.getAttribute('data-message-actions-role')).toBe('assistant');
    expect(pill.className).toContain('absolute');
    expect(pill.className).toContain('bottom-0');
    expect(pill.className).toContain('right-0');
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

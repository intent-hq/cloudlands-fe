/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {}, dispatch: vi.fn() });
});

function readable<T>(value: T) {
  return Object.assign(
    () => ({
      subscribe: (run: (v: T) => void) => {
        run(value);
        return () => {};
      },
    }),
    { select: () => value },
  );
}

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: readable<string | null>('ws-1'),
  selectWorkspaceById: readable<unknown>(undefined),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: readable<unknown[]>([]),
}));

const retired = vi.hoisted(() => ({ value: false }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: readable<unknown>(undefined),
  selectAgentGoal: readable<string | null>('Ship the goal strip'),
  selectAgentRetired: Object.assign(
    () => ({
      subscribe: (run: (v: boolean) => void) => {
        run(retired.value);
        return () => {};
      },
    }),
    { select: () => retired.value },
  ),
}));

vi.mock('$store/renderer/slices/principal/principal-selectors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  selectConversationGoalSupported: readable<boolean>(true),
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/AgentAvatar.svelte')).default,
}));

vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

function goalRow(metadata: Record<string, unknown>, text = 'Goal set: x'): AgentMessage {
  return {
    id: 'msg-goal',
    role: 'system',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date().toISOString(),
    metadata: { type: 'goal_command', ...metadata } as AgentMessage['metadata'],
  };
}

describe('ChatMessage - goal_command notice', () => {
  it('renders a set notice as an operational row, not a message bubble', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: goalRow({ action: 'set', goal: 'Ship the goal strip' }),
        isStreaming: false,
        agentId: 'agent-1',
      },
    });
    expect(container.querySelector('.goal-notice')).toBeTruthy();
    expect(container.querySelector('[data-message-role]')).toBeNull();
    expect(screen.getByTestId('goal-notice-text').textContent).toBe(
      m.chat_goalNotice_set_label({ goal: 'Ship the goal strip' }),
    );
    // Only a "Current goal" row offers Edit
    expect(screen.queryByRole('button', { name: m.chat_goalStrip_edit_ariaLabel() })).toBeNull();
  });

  it('expands a goal notice to the full goal with clickable links', async () => {
    const goal = 'Follow https://example.com/contract then land the daemon first';
    render(ChatMessage, {
      props: {
        message: goalRow({ action: 'set', goal }),
        isStreaming: false,
        agentId: 'agent-1',
      },
    });
    const toggle = screen.getByRole('button', { name: m.chat_goalNotice_set_label({ goal }) });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'https://example.com/contract' })).toBeNull();

    await fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = screen.getByTestId('goal-notice-details');
    expect(details.textContent).toBe(m.chat_goalNotice_set_label({ goal }));
    expect(
      screen.getByRole('link', { name: 'https://example.com/contract' }).getAttribute('href'),
    ).toBe('https://example.com/contract');
  });

  it('does not offer expansion on a notice without a goal', () => {
    render(ChatMessage, {
      props: { message: goalRow({ action: 'cleared', goal: null }), isStreaming: false },
    });
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('renders a cleared notice and a no-goal shown notice', () => {
    const cleared = render(ChatMessage, {
      props: { message: goalRow({ action: 'cleared', goal: null }), isStreaming: false },
    });
    expect(cleared.getByTestId('goal-notice-text').textContent).toBe(
      m.chat_goalNotice_cleared_label(),
    );
    cleared.unmount();

    render(ChatMessage, {
      props: { message: goalRow({ action: 'shown', goal: null }), isStreaming: false },
    });
    expect(screen.getByTestId('goal-notice-text').textContent).toBe(m.chat_goalNotice_none_label());
  });

  it('offers Edit on a "Current goal" row of a writable conversation', () => {
    render(ChatMessage, {
      props: {
        message: goalRow({ action: 'shown', goal: 'Ship the goal strip' }),
        isStreaming: false,
        agentId: 'agent-1',
        workspace: { id: 'ws-1' } as never,
      },
    });
    expect(screen.getByRole('button', { name: m.chat_goalStrip_edit_ariaLabel() })).toBeTruthy();
  });

  it('hides Edit on a read-only conversation', () => {
    render(ChatMessage, {
      props: {
        message: goalRow({ action: 'shown', goal: 'Ship the goal strip' }),
        isStreaming: false,
        agentId: 'agent-1',
        workspace: { id: 'ws-1' } as never,
        readOnly: true,
      },
    });
    expect(screen.queryByRole('button', { name: m.chat_goalStrip_edit_ariaLabel() })).toBeNull();
  });

  it('hides Edit on a retired conversation even when the host passes no readOnly', () => {
    retired.value = true;
    try {
      render(ChatMessage, {
        props: {
          message: goalRow({ action: 'shown', goal: 'Ship the goal strip' }),
          isStreaming: false,
          agentId: 'agent-1',
          workspace: { id: 'ws-1' } as never,
        },
      });
      expect(screen.queryByRole('button', { name: m.chat_goalStrip_edit_ariaLabel() })).toBeNull();
    } finally {
      retired.value = false;
    }
  });

  it('falls back to the row text for an unknown action', () => {
    const { container } = render(ChatMessage, {
      props: { message: goalRow({ action: 'future' }, 'Some text'), isStreaming: false },
    });
    expect(container.querySelector('.goal-notice')).toBeNull();
  });
});

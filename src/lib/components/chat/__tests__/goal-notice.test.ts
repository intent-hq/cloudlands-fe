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

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: readable<unknown>(undefined),
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
  it('renders a set notice as a centered inline divider, not a message bubble', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: goalRow({ action: 'set', goal: 'Ship the goal strip' }),
        isStreaming: false,
        agentId: 'agent-1',
      },
    });
    const notice = container.querySelector('.goal-notice');
    expect(notice).toBeTruthy();
    expect(container.querySelector('[data-message-role]')).toBeNull();
    // Drawn by the shared divider the model-change notices use.
    expect(notice!.querySelector('[role="status"]')).toBeTruthy();
    // The full text is on hover of the one-line label.
    const toggle = screen.getByRole('button', {
      name: m.chat_goalNotice_set_label({ goal: 'Ship the goal strip' }),
    });
    expect(toggle.getAttribute('title')).toBe(
      m.chat_goalNotice_set_label({ goal: 'Ship the goal strip' }),
    );
    expect(screen.getByTestId('goal-notice-text').textContent).toBe(
      m.chat_goalNotice_set_label({ goal: 'Ship the goal strip' }),
    );
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

  it('never offers Edit, even on a "Current goal" row of a writable conversation', () => {
    render(ChatMessage, {
      props: {
        message: goalRow({ action: 'shown', goal: 'Ship the goal strip' }),
        isStreaming: false,
        agentId: 'agent-1',
        workspace: { id: 'ws-1' } as never,
      },
    });
    // The goal strip owns Edit and Remove; transcript notices only report.
    expect(
      screen.getByRole('button', {
        name: m.chat_goalNotice_current_label({ goal: 'Ship the goal strip' }),
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.chat_goalStrip_edit_ariaLabel() })).toBeNull();
  });

  it('falls back to the row text for an unknown action', () => {
    const { container } = render(ChatMessage, {
      props: { message: goalRow({ action: 'future' }, 'Some text'), isStreaming: false },
    });
    expect(container.querySelector('.goal-notice')).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '$shared/types';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({
      subscribe: (run: (value: string | null) => void) => {
        run('ws-1');
        return () => {};
      },
    }),
    { select: () => 'ws-1' },
  ),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: any[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: any) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

// Stub the edit-mode input; its real dependency tree (ModelPicker → useAgentSession)
// needs live store context that these rendering tests don't exercise.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

function userMessage(metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello from another agent' }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
    ...(metadata ? { metadata } : {}),
  };
}

describe('ChatMessage agent-to-agent sender attribution', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
  });

  it('renders the attribution header for an agent_message user row', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    const header = screen.getByTestId('agent-message-attribution');
    expect(header).toBeTruthy();
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('sent a message')).toBeTruthy();
    const avatar = screen.getByTestId('auggie-avatar');
    expect(avatar.getAttribute('data-agent-id')).toBe('agent-sender-1');
    // Message body still renders
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('dispatches openAgentTabRequested with the sender agent id on click', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    await fireEvent.click(screen.getByTestId('agent-message-attribution'));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const action = dispatchMock.mock.calls[0][0];
    expect(action.type).toBe('appLayout/openAgentTabRequested');
    expect(action.payload[0]).toBe('ws-1');
    expect(action.payload[1]).toMatchObject({ agentId: 'agent-sender-1' });
  });

  it('falls back to "Agent" when fromAgentName is absent', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({ type: 'agent_message', fromAgentId: 'agent-sender-2' }),
      },
    });

    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('renders a plain user message without the attribution header', () => {
    render(ChatMessage, { props: { message: userMessage() } });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores malformed metadata (missing fromAgentId)', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentName: 'Builder' }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores non-string fromAgentId', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentId: 42 }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
  });

  it('does not enter edit mode when clicking an attributed message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
        onEditSubmit,
      },
    });

    await fireEvent.click(screen.getByText('hello from another agent'));

    // Still rendering the message (no edit input swapped in)
    expect(screen.getByText('hello from another agent')).toBeTruthy();
    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
  });

  it('keeps click-to-edit for plain user messages', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: userMessage(), onEditSubmit },
    });

    await fireEvent.click(screen.getByText('hello from another agent'));

    // Edit mode replaces the message body view
    expect(screen.queryByText('hello from another agent')).toBeNull();
  });
});

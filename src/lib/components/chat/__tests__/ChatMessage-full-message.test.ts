import { screen, waitFor } from '@testing-library/svelte';
import { render, fireEvent } from './operational-renderer-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '$shared/types';

const dispatchMock = vi.hoisted(() => vi.fn());
const mockStoreState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mockStoreState.value,
    dispatch: dispatchMock,
  });
});

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

const mockStoreMessage = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: any) => void) => {
        run(mockStoreMessage.value);
        return () => {};
      },
    }),
    { select: () => mockStoreMessage.value },
  ),
  selectAgentSession: Object.assign(
    () => ({
      subscribe: (run: (value: undefined) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import ChatMessage from '../ChatMessage.svelte';
import { store as mockStore } from '$store/renderer/store';

describe('ChatMessage single-message bound (§5.5): Show full message', () => {
  const HUGE = 'a'.repeat(2048);

  beforeEach(() => {
    dispatchMock.mockReset();
    mockStoreState.value = {};
    mockStoreMessage.value = undefined;
  });

  function setHydration(entries: Record<string, unknown>) {
    mockStoreState.value = {
      chatState: { byAgentId: { 'agent-1': { hydratedBlocks: entries } } },
    };
    (mockStore as unknown as { emitState: () => void }).emitState();
  }

  function cutAssistantMessage(): AgentMessage {
    return {
      id: 'msg-cut',
      role: 'assistant',
      contentBlocks: [
        { type: 'text', id: 'msg-cut:0', text: HUGE, textTruncated: true, textBytes: 600_000 },
        { type: 'tool_use', id: 'msg-cut:1', name: 'view', input: { path: 'a.rs' } },
        { type: 'tool_result', id: 'msg-cut:2', bodyOmitted: true },
      ],
      timestamp: new Date('2026-11-04T00:00:00Z'),
    };
  }

  it('shows no action for a message that was not cut', () => {
    const message: AgentMessage = {
      id: 'msg-plain',
      role: 'assistant',
      contentBlocks: [{ type: 'text', id: 'msg-plain:0', text: 'hello' }],
      timestamp: new Date('2026-11-04T00:00:00Z'),
    };
    mockStoreMessage.value = message;
    render(ChatMessage, { props: { message, agentId: 'agent-1', messageId: 'msg-plain' } });
    expect(screen.queryByTestId('chat-message-show-full-message')).toBeNull();
  });

  it('requests every cut block, then renders the full text and the loaded stub', async () => {
    const message = cutAssistantMessage();
    mockStoreMessage.value = message;
    dispatchMock.mockImplementation((action) => {
      if (action?.type === 'chatState/messageBlockHydrationRequested') {
        setHydration({
          'msg-cut|msg-cut:0': { status: 'loading', seq: 1 },
          'msg-cut|msg-cut:2': { status: 'loading', seq: 2 },
        });
      }
    });
    render(ChatMessage, { props: { message, agentId: 'agent-1', messageId: 'msg-cut' } });

    const button = screen.getByRole('button', { name: 'Show full message' });
    await fireEvent.click(button);
    const requested = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/messageBlockHydrationRequested')
      .map((action) => action.payload);
    expect(requested).toEqual([
      ['agent-1', 'msg-cut', 'msg-cut:0'],
      ['agent-1', 'msg-cut', 'msg-cut:2'],
    ]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Loading full message…' })).toBeTruthy(),
    );

    setHydration({
      'msg-cut|msg-cut:0': {
        status: 'loaded',
        seq: 3,
        block: { type: 'text', id: 'msg-cut:0', text: 'THE WHOLE MESSAGE TEXT' },
      },
      'msg-cut|msg-cut:2': {
        status: 'loaded',
        seq: 4,
        block: { type: 'tool_result', id: 'msg-cut:2', tool_use_id: 'msg-cut:1', output: 'ok' },
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/THE WHOLE MESSAGE TEXT/)).toBeTruthy();
      expect(screen.queryByTestId('chat-message-show-full-message')).toBeNull();
    });
  });

  it('shows the failure and lets the user retry', async () => {
    const message = cutAssistantMessage();
    mockStoreMessage.value = message;
    render(ChatMessage, { props: { message, agentId: 'agent-1', messageId: 'msg-cut' } });
    setHydration({ 'msg-cut|msg-cut:0': { status: 'error', seq: 1, error: 'offline' } });
    await waitFor(() =>
      expect(screen.getByText("Couldn't load the full message. Try again.")).toBeTruthy(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Show full message' }));
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chatState/messageBlockHydrationRequested',
        payload: ['agent-1', 'msg-cut', 'msg-cut:0'],
      }),
    );
  });

  it('offers the action on a cut user message and shows the loaded full text', async () => {
    const message: AgentMessage = {
      id: 'msg-user-cut',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          id: 'msg-user-cut:0',
          text: 'start of',
          textTruncated: true,
          textBytes: 600_000,
        },
      ],
      timestamp: new Date('2026-11-04T00:00:00Z'),
    };
    mockStoreMessage.value = message;
    render(ChatMessage, { props: { message, agentId: 'agent-1', messageId: 'msg-user-cut' } });
    expect(screen.getByRole('button', { name: 'Show full message' })).toBeTruthy();
    setHydration({
      'msg-user-cut|msg-user-cut:0': {
        status: 'loaded',
        seq: 1,
        block: { type: 'text', id: 'msg-user-cut:0', text: 'start of the full user message' },
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/start of the full user message/)).toBeTruthy();
      expect(screen.queryByTestId('chat-message-show-full-message')).toBeNull();
    });
  });
});

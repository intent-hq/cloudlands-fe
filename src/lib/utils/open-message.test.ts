/**
 * Unit tests for the deep-open helper (openMessage).
 *
 * The backend seam (`appClient.agents.getConversation`), the store, and
 * SvelteKit's `goto` are all mocked; the tests assert the navigation +
 * hydration + hand-off choreography, including the §5.5 `aroundMessageId`
 * seek path for messages absent from the (pruned) store.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockDispatch, mockState, mockGetConversation } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockState: { value: {} as Record<string, unknown> },
  mockGetConversation: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => mockState.value,
    dispatch: mockDispatch,
  });
});

vi.mock('$lib/client', () => ({
  appClient: { agents: { getConversation: mockGetConversation } },
}));

vi.mock('$store/renderer/slices/app-layout/app-layout-slice', () => ({
  openAgentTabRequested: Object.assign(
    (...args: unknown[]) => ({ type: 'appLayout/openAgentTabRequested', payload: args }),
    { type: 'appLayout/openAgentTabRequested' },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  replaceMessages: Object.assign(
    (...args: unknown[]) => ({ type: 'agentSessions/replaceMessages', payload: args }),
    { type: 'agentSessions/replaceMessages' },
  ),
}));

import { goto } from '$app/navigation';
import { openMessage } from './open-message';

function stateWith({
  messages = [] as Array<{ id: string }>,
  hydration,
}: {
  messages?: Array<{ id: string }>;
  hydration?: 'loading' | 'settled';
}) {
  return {
    agentSessions: { byAgentId: { 'agent-1': { messages } } },
    chatState: {
      byAgentId: hydration ? { 'agent-1': { transcriptHydration: hydration } } : {},
    },
  };
}

function setPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { pathname },
    writable: true,
  });
}

describe('openMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (goto as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    mockState.value = stateWith({ messages: [{ id: 'msg-1' }] });
    setPathname('/workspace/ws-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the agent tab and dispatches the scroll hand-off when the message is loaded', async () => {
    const eventListener = vi.fn();
    window.addEventListener('chat:open-message', eventListener);

    const done = openMessage({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      messageId: 'msg-1',
      query: 'hello world',
    });
    await vi.runAllTimersAsync();
    await done;

    // Already on /workspace/ws-1 — no route navigation.
    expect(goto).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'appLayout/openAgentTabRequested',
      payload: ['ws-1', { agentId: 'agent-1' }],
    });
    // Message already in the store — no seek fetch.
    expect(mockGetConversation).not.toHaveBeenCalled();
    expect(eventListener).toHaveBeenCalled();
    const detail = (eventListener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      agentId: 'agent-1',
      messageId: 'msg-1',
      query: 'hello world',
    });
    expect(detail.requestId).toEqual(expect.any(String));

    window.removeEventListener('chat:open-message', eventListener);
  });

  it('navigates to the workspace route when opened cross-workspace', async () => {
    setPathname('/workspace/ws-OTHER');

    const done = openMessage({ workspaceId: 'ws-1', agentId: 'agent-1', messageId: 'msg-1' });
    await vi.runAllTimersAsync();
    await done;

    expect(goto).toHaveBeenCalledWith('/workspace/ws-1');
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'appLayout/openAgentTabRequested',
      payload: ['ws-1', { agentId: 'agent-1' }],
    });
  });

  it('seeks the page via aroundMessageId when the message is absent after hydration settles', async () => {
    // Old message pruned from the (500-cap) store; hydration settled without it.
    mockState.value = stateWith({ messages: [{ id: 'msg-recent' }], hydration: 'settled' });
    const seekPage = {
      messages: [{ id: 'msg-old-1' }, { id: 'msg-1' }, { id: 'msg-old-2' }],
      truncated: true,
      totalMessages: 900,
      nextToken: 'older',
      prevToken: 'newer',
    };
    mockGetConversation.mockImplementation(async () => {
      // The replaceMessages upsert lands the seek page in the store.
      mockState.value = stateWith({ messages: seekPage.messages, hydration: 'settled' });
      return seekPage;
    });
    const eventListener = vi.fn();
    window.addEventListener('chat:open-message', eventListener);

    const done = openMessage({ workspaceId: 'ws-1', agentId: 'agent-1', messageId: 'msg-1' });
    await vi.runAllTimersAsync();
    await done;

    expect(mockGetConversation).toHaveBeenCalledWith('agent-1', 200, undefined, 'msg-1');
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'agentSessions/replaceMessages',
      payload: ['agent-1', seekPage.messages],
    });
    expect(eventListener).toHaveBeenCalled();

    window.removeEventListener('chat:open-message', eventListener);
  });

  it('falls back gracefully (no scroll event) when the message no longer exists', async () => {
    mockState.value = stateWith({ messages: [], hydration: 'settled' });
    // Daemon rejects an unknown message id with -32602.
    mockGetConversation.mockRejectedValue(new Error('unknown message id: msg-gone'));
    const eventListener = vi.fn();
    window.addEventListener('chat:open-message', eventListener);

    const done = openMessage({ workspaceId: 'ws-1', agentId: 'agent-1', messageId: 'msg-gone' });
    await vi.runAllTimersAsync();
    await done;

    // Conversation still opened (tab dispatch) but no scroll hand-off.
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'appLayout/openAgentTabRequested',
      payload: ['ws-1', { agentId: 'agent-1' }],
    });
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agentSessions/replaceMessages' }),
    );
    expect(eventListener).not.toHaveBeenCalled();

    window.removeEventListener('chat:open-message', eventListener);
  });

  it('waits for hydration to land the message before dispatching the hand-off', async () => {
    // Message not yet in the store; hydration in flight.
    mockState.value = stateWith({ messages: [], hydration: 'loading' });
    const eventListener = vi.fn();
    window.addEventListener('chat:open-message', eventListener);

    const done = openMessage({ workspaceId: 'ws-1', agentId: 'agent-1', messageId: 'msg-1' });
    // Let a couple of polls elapse, then land the message.
    await vi.advanceTimersByTimeAsync(400);
    mockState.value = stateWith({ messages: [{ id: 'msg-1' }], hydration: 'settled' });
    await vi.runAllTimersAsync();
    await done;

    expect(mockGetConversation).not.toHaveBeenCalled();
    expect(eventListener).toHaveBeenCalled();

    window.removeEventListener('chat:open-message', eventListener);
  });
});

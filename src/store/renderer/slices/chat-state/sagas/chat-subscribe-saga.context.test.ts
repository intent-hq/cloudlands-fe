import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPending: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    chat: { subscribe: mocks.subscribe },
  },
}));

vi.mock('$features/agent/utils/pending-agent-deletions', () => ({
  isAgentDeletionPending: mocks.isPending,
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    *effect() {
      return undefined;
    },
  },
}));

vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectCurrentlyViewedAgentId: {
    *effect() {
      return null;
    },
  },
}));

import { initializeChatRequested } from '../chat-state-slice';
import { chatSubscribeSaga } from './chat-subscribe-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('chatSubscribeSaga contextual arbitration', () => {
  afterEach(() => vi.clearAllMocks());

  it('leads per agent, runs agents concurrently, reuses completion, and cleans up on cancel', async () => {
    const input = stdChannel();
    const dispatch = vi.fn();
    const unsubscribeA = vi.fn();
    const unsubscribeB = vi.fn();
    let resolveFirst!: (pending: boolean) => void;
    mocks.isPending
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockReturnValue(false);
    mocks.subscribe.mockReturnValueOnce(unsubscribeB).mockReturnValueOnce(unsubscribeA);
    const task = runSaga({ channel: input, dispatch, getState: () => ({}) }, chatSubscribeSaga);
    await settle();

    input.put(initializeChatRequested('agent-a', { wsId: 'ws-a' }));
    await settle();
    input.put(initializeChatRequested('agent-a', { wsId: 'ws-a' }));
    input.put(initializeChatRequested('agent-b', { wsId: 'ws-b' }));
    await settle();

    expect(mocks.isPending.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-a', 'agent-b']);
    expect(mocks.subscribe.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-b']);

    resolveFirst(true);
    await settle();
    input.put(initializeChatRequested('agent-a', { wsId: 'ws-a' }));
    await settle();

    expect(mocks.subscribe.mock.calls.map(([agentId]) => agentId)).toEqual(['agent-b', 'agent-a']);

    task.cancel();
    await task.toPromise();
    expect(unsubscribeA).toHaveBeenCalledOnce();
    expect(unsubscribeB).toHaveBeenCalledOnce();
  });
});

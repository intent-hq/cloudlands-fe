import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import type { AgentMessage, AgentSession } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  acquireChatInterestLease,
  clearAllChatInterestLeases,
  releaseChatInterestLease,
} from '$features/agent/utils/chat-interest-leases';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as initialAgentSessionState,
  prependHistoryMessages,
} from '../../agent-session/agent-session-slice';
import {
  chatStateReducer,
  initialState as initialChatState,
  messageBlockHydrated,
  messageBlockHydrationRequested,
  streamCompleted,
} from '../../chat-state/chat-state-slice';

import {
  closeWorkspaceTab,
  openWorkspaceTab,
  restoreWorkspaceTab,
  tabStateReducer,
} from '../../tab-state/tab-state-slice';
import {
  initialState as initialWorkspaceLifecycleState,
  workspaceDeleted,
  workspaceChatStateReclaimed,
  workspaceLoadRequested,
  workspaceLifecycleReducer,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { workspaceTabCleanupSaga } from './workspace-tab-cleanup-saga';

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

function makeSession(
  id: string,
  workspaceId: string,
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    id: id as AgentSession['id'],
    backendSessionId: null,
    workspaceId: workspaceId as AgentSession['workspaceId'],
    name: `Agent ${id}`,
    status: 'idle',
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function payloadMessages(prefix: string, count: number): AgentMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: 'assistant',
    seq: index,
    timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    contentBlocks: [{ type: 'text', text: `${prefix}-${'x'.repeat(256)}` }],
  }));
}

function createHarness(
  openWorkspaceIds: string[] = [],
  liveWorkspaceIds: string[] = [],
  sessions: AgentSession[] = [],
) {
  const initialTabState = openWorkspaceIds.reduce(
    (state, workspaceId) => tabStateReducer(state, openWorkspaceTab(workspaceId)),
    tabStateReducer(undefined, { type: '@@INIT' }),
  );
  const initialLifecycleState = liveWorkspaceIds.reduce(
    (lifecycleState, workspaceId) =>
      workspaceLifecycleReducer(
        workspaceLifecycleReducer(lifecycleState, workspaceMounted(workspaceId)),
        workspaceOpenSucceeded(workspaceId),
      ),
    initialWorkspaceLifecycleState,
  );
  const initialAgentSessions = agentSessionReducer(
    initialAgentSessionState,
    bulkUpsertSessions(sessions, { preserveExplicitRuntimeFlags: false }),
  );
  let state = {
    tabState: initialTabState,
    workspaceLifecycle: initialLifecycleState,
    agentSessions: initialAgentSessions,
    chatState: initialChatState,
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof tabStateReducer>[1]) => {
    state = {
      tabState: tabStateReducer(state.tabState, action),
      workspaceLifecycle: workspaceLifecycleReducer(state.workspaceLifecycle, action),
      agentSessions: agentSessionReducer(state.agentSessions, action),
      chatState: chatStateReducer(state.chatState, action),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    workspaceTabCleanupSaga,
  );
  return { dispatch, getState: reduxStore.getState, task };
}

function lifecycleActions(harness: ReturnType<typeof createHarness>) {
  return harness.dispatch.mock.calls
    .map(([action]) => action)
    .filter(
      (action) =>
        action.type === workspaceUnmounted.type || action.type === workspaceLoadRequested.type,
    );
}

function reclamationActions(harness: ReturnType<typeof createHarness>) {
  return harness.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === workspaceChatStateReclaimed.type);
}

describe('workspaceTabCleanupSaga', () => {
  afterEach(() => clearAllChatInterestLeases());
  it('hydrates the initially focused workspace', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();

    expect(lifecycleActions(harness)).toEqual([workspaceLoadRequested('ws-B')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('emits no hydration requests across live A → B → A focus changes', async () => {
    const harness = createHarness(['ws-B', 'ws-A'], ['ws-A', 'ws-B']);
    await settle();

    harness.dispatch(openWorkspaceTab('ws-B'));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not emit another lifecycle action for same-tab selection', async () => {
    const harness = createHarness(['ws-A']);
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([workspaceLoadRequested('ws-A')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts an actively closed workspace once before hydrating the next focus', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-B', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceLoadRequested('ws-B'),
      workspaceUnmounted('ws-B'),
      workspaceLoadRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not unmount a still-open background workspace when focus changes', async () => {
    const harness = createHarness(['ws-A', 'ws-B'], ['ws-A', 'ws-B']);
    await settle();

    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-B'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([]);
    expect(lifecycleActions(harness)).not.toContainEqual(workspaceUnmounted('ws-A'));
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts a background workspace when its tab closes', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceLoadRequested('ws-B'),
      workspaceUnmounted('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('unmounts a background workspace when it is deleted', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-A', []));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceLoadRequested('ws-B'),
      workspaceUnmounted('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('hydrates a recreated same-ID workspace after background deletion', async () => {
    const harness = createHarness(['ws-A', 'ws-B'], ['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-A', []));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceUnmounted('ws-A'),
      workspaceLoadRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('hydrates a workspace again after its live session fails', async () => {
    const harness = createHarness(['ws-B', 'ws-A'], ['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceOpenFailed('ws-A'));
    harness.dispatch(openWorkspaceTab('ws-B'));
    await settle();
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(lifecycleActions(harness)).toEqual([workspaceLoadRequested('ws-A')]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not unmount twice when active deletion is followed by tab removal', async () => {
    const harness = createHarness(['ws-A', 'ws-B']);
    await settle();
    harness.dispatch(workspaceDeleted('ws-B', []));
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-B', 1));
    await settle();

    expect(lifecycleActions(harness)).toEqual([
      workspaceLoadRequested('ws-B'),
      workspaceUnmounted('ws-B'),
      workspaceLoadRequested('ws-A'),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('reclaims the bounded agent set when the final workspace tab closes', async () => {
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [makeSession('agent-a', 'ws-A'), makeSession('agent-b', 'ws-B')],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();

    expect(reclamationActions(harness)).toEqual([workspaceChatStateReclaimed('ws-A', ['agent-a'])]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('waits for the last chat-interest lease before reclaiming', async () => {
    acquireChatInterestLease('agent-a', 'test-panel');
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [makeSession('agent-a', 'ws-A')],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();
    expect(reclamationActions(harness)).toEqual([]);

    releaseChatInterestLease('agent-a', 'test-panel');
    await settle();
    expect(reclamationActions(harness)).toEqual([workspaceChatStateReclaimed('ws-A', ['agent-a'])]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('waits for an active stream to settle before reclaiming', async () => {
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [makeSession('agent-a', 'ws-A', { isStreaming: true })],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();
    expect(reclamationActions(harness)).toEqual([]);

    harness.dispatch(
      streamCompleted('agent-a', { lastAttemptedMessage: null, modelUnavailable: null }),
    );
    await settle();
    expect(reclamationActions(harness)).toEqual([workspaceChatStateReclaimed('ws-A', ['agent-a'])]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('never reclaims chief workspace chat state', async () => {
    const harness = createHarness(
      [CHIEF_WORKSPACE_ID, 'ws-B'],
      [CHIEF_WORKSPACE_ID, 'ws-B'],
      [makeSession('chief-agent', CHIEF_WORKSPACE_ID)],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab(CHIEF_WORKSPACE_ID, 1));
    await settle();

    expect(reclamationActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not reclaim when a workspace reopens during close-boundary deferral', async () => {
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [makeSession('agent-a', 'ws-A')],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    harness.dispatch(openWorkspaceTab('ws-A'));
    await settle();

    expect(reclamationActions(harness)).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('reclaims repeated populated close cycles while preserving the open workspace control', async () => {
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [
        makeSession('agent-a', 'ws-A', { messages: payloadMessages('tail-a-1', 8) }),
        makeSession('agent-b', 'ws-B', { messages: payloadMessages('tail-b', 8) }),
      ],
    );
    await settle();

    const populateHistoryAndBlock = (agentId: string, prefix: string) => {
      harness.dispatch(prependHistoryMessages(agentId, payloadMessages(`history-${prefix}`, 12)));
      harness.dispatch(
        messageBlockHydrationRequested(agentId, `message-${prefix}`, `block-${prefix}`),
      );
      harness.dispatch(
        messageBlockHydrated(agentId, `message-${prefix}`, `block-${prefix}`, {
          type: 'text',
          text: `hydrated-${prefix}-${'y'.repeat(512)}`,
        }),
      );
    };
    populateHistoryAndBlock('agent-a', 'a-1');
    populateHistoryAndBlock('agent-b', 'b');

    const expectClosedPayloadPurged = () => {
      const state = harness.getState();
      expect(state.agentSessions.byAgentId['agent-a']).toBeUndefined();
      expect(state.agentSessions.historySegmentsByAgentId?.['agent-a']).toBeUndefined();
      expect(state.chatState.byAgentId['agent-a']).toBeUndefined();
    };
    const expectOpenControlPreserved = () => {
      const state = harness.getState();
      expect(state.agentSessions.byAgentId['agent-b'].messages).toHaveLength(8);
      expect(state.agentSessions.historySegmentsByAgentId?.['agent-b']?.messages).toHaveLength(12);
      expect(
        state.chatState.byAgentId['agent-b'].hydratedBlocks?.['message-b|block-b'],
      ).toMatchObject({
        status: 'loaded',
        block: { type: 'text', text: expect.stringContaining('hydrated-b-') },
      });
    };

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();
    expectClosedPayloadPurged();
    expectOpenControlPreserved();

    harness.dispatch(restoreWorkspaceTab('ws-A'));
    harness.dispatch(
      bulkUpsertSessions([
        makeSession('agent-a', 'ws-A', { messages: payloadMessages('tail-a-2', 8) }),
      ]),
    );
    populateHistoryAndBlock('agent-a', 'a-2');
    await settle();
    expect(harness.getState().agentSessions.byAgentId['agent-a'].messages).toHaveLength(8);
    expect(harness.getState().chatState.byAgentId['agent-a'].hydratedBlocks).toBeDefined();

    harness.dispatch(closeWorkspaceTab('ws-A', 2));
    await settle();
    expectClosedPayloadPurged();
    expectOpenControlPreserved();

    expect(reclamationActions(harness)).toEqual([
      workspaceChatStateReclaimed('ws-A', ['agent-a']),
      workspaceChatStateReclaimed('ws-A', ['agent-a']),
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('reclaims a background-restored workspace when it closes again', async () => {
    const harness = createHarness(
      ['ws-A', 'ws-B'],
      ['ws-A', 'ws-B'],
      [makeSession('agent-a', 'ws-A', { isStreaming: true })],
    );
    await settle();

    harness.dispatch(closeWorkspaceTab('ws-A', 1));
    await settle();
    harness.dispatch(restoreWorkspaceTab('ws-A'));
    harness.dispatch(
      streamCompleted('agent-a', { lastAttemptedMessage: null, modelUnavailable: null }),
    );
    await settle();
    harness.dispatch(closeWorkspaceTab('ws-A', 2));
    await settle();

    expect(reclamationActions(harness)).toEqual([workspaceChatStateReclaimed('ws-A', ['agent-a'])]);
    harness.task.cancel();
    await harness.task.toPromise();
  });
});

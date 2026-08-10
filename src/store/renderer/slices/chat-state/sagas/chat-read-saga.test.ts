import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getConversation: vi.fn(),
  subscribeSnapshot: vi.fn(),
  seed: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: { get: mocks.get, getConversation: mocks.getConversation },
    chat: { subscribeSnapshot: mocks.subscribeSnapshot },
  },
}));
vi.mock('$features/events/daemon-events-bridge.client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$features/events/daemon-events-bridge.client')>();
  return { ...actual, seedStreamFromSnapshot: mocks.seed };
});

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
} from '../../agent-session/agent-session-slice';
import {
  chatStateReducer,
  initializeChatRequested,
  initialState as chatStateInitialState,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { chatReadSaga } from './chat-read-saga';

const WS = 'ws-chat';
const AGENT = 'agent-chat';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: null,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function message(id: string, text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2026-01-01T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
    ...overrides,
  };
}

function harness() {
  const channel = stdChannel();
  let agentSessions = agentSessionInitialState;
  let chatState = chatStateInitialState;
  const dispatch = vi.fn((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSessions, chatState }) },
    chatReadSaga,
  );
  return { channel, dispatch, task, sessions: () => agentSessions, chat: () => chatState };
}

describe('chatReadSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('pages getConversation with exact arguments, preserves order, and merges the snapshot stream', async () => {
    mocks.get.mockResolvedValue(session());
    mocks.getConversation
      .mockResolvedValueOnce({ messages: [message('new', 'new')], nextToken: 'older' })
      .mockResolvedValueOnce({ messages: [message('old', 'old')], nextToken: null });
    const live = message('live', 'partial', { isStreaming: true });
    mocks.subscribeSnapshot.mockResolvedValue({ messages: [live] });
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined],
      [AGENT, 200, 'older'],
    ]);
    expect(mocks.subscribeSnapshot).toHaveBeenCalledWith(AGENT);
    expect(mocks.seed).toHaveBeenCalledWith(AGENT, live, WS);
    expect(run.sessions().byAgentId[AGENT]?.messages.map((item) => item.id)).toEqual([
      'old',
      'new',
      'live',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrates different agents concurrently and settles both reads', async () => {
    let resolveFirst!: (value: AgentSession) => void;
    mocks.get
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockResolvedValue(session({ id: 'agent-other', workspaceId: 'ws-other' }));
    mocks.getConversation.mockImplementation(async (agentId: string) => ({
      messages: [message(`${agentId}-message`, 'fresh')],
      nextToken: null,
    }));
    mocks.subscribeSnapshot.mockResolvedValue({ messages: [] });
    const run = harness();
    run.channel.put(refreshChatTranscriptRequested(WS, AGENT));
    await settle();
    run.channel.put(refreshChatTranscriptRequested('ws-other', 'agent-other'));
    await settle();
    resolveFirst(session());
    await settle();

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.getConversation.mock.calls).toEqual([
      ['agent-other', 200, undefined],
      [AGENT, 200, undefined],
    ]);
    expect(run.sessions().byAgentId[AGENT]?.messages.map((item) => item.id)).toEqual([
      `${AGENT}-message`,
    ]);
    expect(run.sessions().byAgentId['agent-other']?.messages.map((item) => item.id)).toEqual([
      'agent-other-message',
    ]);
    const settledAgentIds = run.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === transcriptHydrationSettled.type)
      .map((action) => action.payload[0]);
    expect(settledAgentIds).toEqual(expect.arrayContaining([AGENT, 'agent-other']));
    expect(settledAgentIds).toHaveLength(2);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps readiness loading while the latest same-agent read is pending', async () => {
    let resolveFirst!: (value: { messages: AgentMessage[]; nextToken: null }) => void;
    let resolveSecond!: (value: { messages: AgentMessage[]; nextToken: null }) => void;
    mocks.get.mockResolvedValue(session());
    mocks.getConversation
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveSecond = done;
        }),
      );
    mocks.subscribeSnapshot.mockResolvedValue({ messages: [] });
    const run = harness();

    run.channel.put(refreshChatTranscriptRequested(WS, AGENT));
    await settle();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    resolveFirst({ messages: [message('stale', 'stale')], nextToken: null });
    await vi.waitFor(() => expect(mocks.getConversation).toHaveBeenCalledTimes(2));

    const hydrationTransitions = run.dispatch.mock.calls
      .map(([action]) => action)
      .filter(
        (action) =>
          action.type === transcriptHydrationStarted.type ||
          action.type === transcriptHydrationSettled.type,
      )
      .map((action) => action.type);
    expect(hydrationTransitions).toEqual([
      transcriptHydrationStarted.type,
      transcriptHydrationStarted.type,
    ]);
    expect(
      run.dispatch.mock.calls.filter(([action]) => action.type === transcriptHydrationSettled.type),
    ).toHaveLength(0);
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');

    resolveSecond({ messages: [message('fresh', 'fresh')], nextToken: null });
    await vi.waitFor(() =>
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled'),
    );
    expect(
      run.dispatch.mock.calls.filter(([action]) => action.type === transcriptHydrationSettled.type),
    ).toHaveLength(1);
    expect(run.sessions().byAgentId[AGENT]?.messages.map((item) => item.id)).toEqual(['fresh']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('preserves messages appended while paging is in flight', async () => {
    let resolvePage!: (value: { messages: AgentMessage[]; nextToken: null }) => void;
    mocks.get.mockResolvedValue(session());
    mocks.getConversation.mockReturnValue(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    mocks.subscribeSnapshot.mockResolvedValue({ messages: [] });
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('during', 'during')] })]));
    resolvePage({ messages: [message('persisted', 'persisted')], nextToken: null });
    await settle();

    expect(run.sessions().byAgentId[AGENT]?.messages.map((item) => item.id)).toEqual([
      'persisted',
      'during',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles a failed read without replacing the prior transcript', async () => {
    mocks.get.mockRejectedValue(new Error('read failed'));
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('prior', 'prior')] })]));
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(run.sessions().byAgentId[AGENT]?.messages.map((item) => item.id)).toEqual(['prior']);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationSettled.type),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an unmounted workspace read without a late upsert or settled ghost action', async () => {
    let resolve!: (value: AgentSession) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve(session());
    await settle();

    expect(run.sessions().byAgentId[AGENT]).toBeUndefined();
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationSettled.type),
    ).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });
});

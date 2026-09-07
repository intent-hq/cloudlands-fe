import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ get: vi.fn(), invoke: vi.fn(() => Promise.resolve()) }));
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { agents: { get: mocks.get } } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => loggerMocks,
  logger: loggerMocks,
}));

import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as initialAgentSessionState,
} from '../../agent-session/agent-session-slice';
import { closeTabsByAgentId, destroyTabsByOwnerAgent } from '../../panel-layout/panel-layout-slice';
import {
  clearPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import { agentReadSaga } from './agent-read-saga';

const WS = 'ws-read';
const AGENT = 'agent-read';
const settle = async () => {
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

describe('agentReadSaga', () => {
  afterEach(() => {
    clearPendingAgentDeletions();
    vi.clearAllMocks();
  });

  it('calls agents.get exactly and preserves an existing transcript on metadata refresh', async () => {
    const messages = [
      {
        id: 'message-1',
        role: 'user' as const,
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text' as const, text: 'hello' }],
      },
    ];
    mocks.get.mockResolvedValue(session({ name: 'refreshed' }));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({ agentSessions: { byAgentId: { [AGENT]: session({ messages }) } } }),
      },
      agentReadSaga,
    );
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    const upsert = dispatch.mock.calls.find(
      ([action]) => action.type === bulkUpsertSessions.type,
    )?.[0];
    expect(upsert.payload[0][0]).toMatchObject({ name: 'refreshed', messages });
    task.cancel();
    await task.toPromise();
  });

  it('replaces blank-agent specialist metadata and default model with the daemon projection', async () => {
    const existing = session({ model: 'default-model', metadata: {} });
    const hydrated = session({
      model: 'grok4.6',
      metadata: { specialist: 'spec-writer' },
    });
    mocks.get.mockResolvedValue(hydrated);
    const channel = stdChannel();
    let agentSessions = agentSessionReducer(
      initialAgentSessionState,
      bulkUpsertSessions([existing]),
    );
    const dispatch = vi.fn((action) => {
      agentSessions = agentSessionReducer(agentSessions, action);
    });
    const task = runSaga({ channel, dispatch, getState: () => ({ agentSessions }) }, agentReadSaga);

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(agentSessions.byAgentId[AGENT]).toMatchObject({
      model: 'grok4.6',
      metadata: { specialist: 'spec-writer' },
    });
    task.cancel();
    await task.toPromise();
  });

  it('does not swallow a specialist-only hydrate when the model is unchanged', async () => {
    const existing = session({ model: 'grok4.6', metadata: {} });
    mocks.get.mockResolvedValue(
      session({ model: 'grok4.6', metadata: { specialist: 'spec-writer' } }),
    );
    const channel = stdChannel();
    let agentSessions = agentSessionReducer(
      initialAgentSessionState,
      bulkUpsertSessions([existing]),
    );
    const dispatch = vi.fn((action) => {
      agentSessions = agentSessionReducer(agentSessions, action);
    });
    const task = runSaga({ channel, dispatch, getState: () => ({ agentSessions }) }, agentReadSaga);

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(agentSessions.byAgentId[AGENT]?.metadata?.specialist).toBe('spec-writer');
    task.cancel();
    await task.toPromise();
  });

  it('loads a different agent while the first read remains blocked', async () => {
    const otherAgent = 'agent-other';
    let resolveFirst!: (value: AgentSession) => void;
    mocks.get.mockImplementation((agentId: string) => {
      if (agentId === otherAgent) {
        return Promise.resolve(session({ id: otherAgent, name: 'Other Agent' }));
      }
      return new Promise((done) => {
        resolveFirst = done;
      });
    });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    channel.put(ensureAgentSessionLoaded(WS, otherAgent));
    await settle();
    expect(mocks.get).toHaveBeenNthCalledWith(1, AGENT);
    expect(mocks.get).toHaveBeenNthCalledWith(2, otherAgent);
    const completedUpserts = dispatch.mock.calls.filter(
      ([action]) => action.type === bulkUpsertSessions.type,
    );
    expect(completedUpserts).toHaveLength(1);
    expect(completedUpserts[0][0].payload[0][0]).toMatchObject({
      id: otherAgent,
      name: 'Other Agent',
    });

    resolveFirst(session());
    await settle();
    const allUpserts = dispatch.mock.calls.filter(
      ([action]) => action.type === bulkUpsertSessions.type,
    );
    expect(allUpserts).toHaveLength(2);
    expect(allUpserts.map(([action]) => action.payload[0][0].id)).toEqual([otherAgent, AGENT]);
    task.cancel();
    await task.toPromise();
  });

  it('shares one in-flight request between superseding same-agent callers', async () => {
    let resolveShared!: (value: AgentSession) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveShared = done;
        }),
    );
    const channel = stdChannel();
    let agentSessions = initialAgentSessionState;
    const dispatch = vi.fn((action) => {
      agentSessions = agentSessionReducer(agentSessions, action);
    });
    const task = runSaga({ channel, dispatch, getState: () => ({ agentSessions }) }, agentReadSaga);

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(agentSessions.byAgentId[AGENT]).toBeUndefined();

    resolveShared(session({ name: 'shared' }));
    await settle();

    const upserts = dispatch.mock.calls.filter(
      ([action]) => action.type === bulkUpsertSessions.type,
    );
    expect(upserts).toHaveLength(1);
    expect(agentSessions.byAgentId[AGENT]?.name).toBe('shared');
    task.cancel();
    await task.toPromise();
  });

  it('loads after a pending deletion clears', async () => {
    setPendingAgentDeletion({ wsId: WS, agentId: AGENT, snapshot: session(), timer: null });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();
    expect(mocks.get).not.toHaveBeenCalled();

    removePendingAgentDeletion(AGENT);
    mocks.get.mockResolvedValue(session({ name: 'revived' }));
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    const upsert = dispatch.mock.calls.find(
      ([action]) => action.type === bulkUpsertSessions.type,
    )?.[0];
    expect(upsert?.payload[0][0]).toMatchObject({ id: AGENT, name: 'revived' });
    task.cancel();
    await task.toPromise();
  });

  it("skips a row carrying the daemon's pendingDeleteAt deadline (§5.5 delete grace window)", async () => {
    mocks.get.mockResolvedValue(session({ pendingDeleteAt: '2026-08-11T00:00:15.000Z' }));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    expect(
      dispatch.mock.calls.find(([action]) => action.type === bulkUpsertSessions.type),
    ).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  // Regression (monorepo#1753): a stale tab/route referencing a deleted agent
  // makes agent.get reject with -32602 "Agent not found". That is an expected
  // condition: one WARN (no ERROR) and the stale agent tabs are closed so the
  // workspace falls back to its home view.
  it('logs a single WARN and closes stale tabs when the daemon reports the agent missing', async () => {
    // Real live-transport shape: both transports prefer the daemon's
    // data.code ("not-found", monorepo#1320) when resolving BackendError.code.
    const notFound = Object.assign(new Error('Agent not found'), {
      name: 'BackendError',
      code: 'not-found',
      rpcCode: -32602,
      data: { code: 'not-found' },
    });
    mocks.get.mockRejectedValue(notFound);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.error).not.toHaveBeenCalled();
    const close = dispatch.mock.calls.find(
      ([action]) => action.type === closeTabsByAgentId.type,
    )?.[0];
    expect(close?.payload).toMatchObject({ wsId: WS, agentId: AGENT });
    // Missed-deletion recovery (monorepo#2857): the dead agent's owned
    // browser tabs are destroyed and main's CDP/ownership registrations
    // cleared — a pre-purge list-tabs reply may already have rehydrated them.
    const destroy = dispatch.mock.calls.find(
      ([action]) => action.type === destroyTabsByOwnerAgent.type,
    )?.[0];
    expect(destroy?.payload).toMatchObject({ wsId: WS, agentId: AGENT });
    expect(mocks.invoke).toHaveBeenCalledWith('browser:clear-agent-tabs', { agentId: AGENT });
    expect(dispatch.mock.calls.some(([action]) => action.type === bulkUpsertSessions.type)).toBe(
      false,
    );
    task.cancel();
    await task.toPromise();
  });

  it('leaves prior state intact when agents.get fails', async () => {
    mocks.get.mockRejectedValue(new Error('read failed'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({ agentSessions: { byAgentId: { [AGENT]: session() } } }),
      },
      agentReadSaga,
    );
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();

    expect(dispatch).not.toHaveBeenCalled();
    expect(loggerMocks.error).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('cancels an in-flight read on workspace unmount and suppresses its late response', async () => {
    let resolve!: (value: AgentSession) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();
    channel.put(workspaceUnmounted(WS));
    await settle();
    resolve(session());
    await settle();

    expect(dispatch.mock.calls.some(([action]) => action.type === bulkUpsertSessions.type)).toBe(
      false,
    );
    task.cancel();
    await task.toPromise();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { agents: { get: mocks.get } } }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => loggerMocks,
  logger: loggerMocks,
}));

import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { closeTabsByAgentId } from '../../panel-layout/panel-layout-slice';
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
    const messages = [{
      id: 'message-1',
      role: 'user' as const,
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text' as const, text: 'hello' }],
    }];
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
    const upsert = dispatch.mock.calls.find(([action]) => action.type === bulkUpsertSessions.type)?.[0];
    expect(upsert.payload[0][0]).toMatchObject({ name: 'refreshed', messages });
    task.cancel();
    await task.toPromise();
  });

  it('coalesces concurrent trigger actions for one agent', async () => {
    let resolve!: (value: AgentSession) => void;
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ agentSessions: { byAgentId: {} } }) },
      agentReadSaga,
    );

    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    channel.put(ensureAgentSessionLoaded(WS, AGENT));
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    resolve(session());
    await settle();
    task.cancel();
    await task.toPromise();
  });

  it('loads after a pending deletion clears without retaining a stale single-flight entry', async () => {
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
    const upsert = dispatch.mock.calls.find(([action]) => action.type === bulkUpsertSessions.type)?.[0];
    expect(upsert?.payload[0][0]).toMatchObject({ id: AGENT, name: 'revived' });
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
    const close = dispatch.mock.calls.find(([action]) => action.type === closeTabsByAgentId.type)?.[0];
    expect(close?.payload).toMatchObject({ wsId: WS, agentId: AGENT });
    expect(dispatch.mock.calls.some(([action]) => action.type === bulkUpsertSessions.type)).toBe(false);
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
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
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

    expect(dispatch.mock.calls.some(([action]) => action.type === bulkUpsertSessions.type)).toBe(false);
    task.cancel();
    await task.toPromise();
  });
});
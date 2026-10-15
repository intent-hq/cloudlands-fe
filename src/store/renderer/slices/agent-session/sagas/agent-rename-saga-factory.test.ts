import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import type { AgentRenameResult, AgentsClient } from '$lib/client/app-client';
import type { AgentSession } from '$shared/types';
import { createAgentReadOwnership } from '$features/agent/agent-read-ownership-factory';
import { createAgentReadService } from '$features/agent/agent-read-service-factory';
import type { AgentRenameRequest, AgentSessionState } from '../agent-session-types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  restoreStoredSessions,
  updateSession,
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  agentRenameViewOpened,
  agentRenameViewReleased,
  agentRenameOperationQueued,
  agentRenameOperationSettled,
} from '../agent-session-slice';
import {
  getAgentRenameOperations,
  getAgentRenameRevision,
  getAgentRenameViewCurrent,
} from '../agent-session-projections';
import { renameAgentSessionRequested } from '../../workspace-agents/workspace-agents-slice';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { createAgentRenameSaga } from './agent-rename-saga-factory';

const tasks: Task[] = [];
afterEach(() => {
  for (const task of tasks.splice(0)) task.cancel();
});
const row = (name = 'Original') =>
  ({
    id: 'agent',
    workspaceId: 'ws',
    name,
    nameExplicitlySet: false,
    messages: [],
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  }) as AgentSession;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(rename?: AgentsClient['rename']) {
  let state = {
    agentSessions: agentSessionReducer(
      agentSessionReducer.initialState,
      bulkUpsertSessions([row()]),
    ),
  };
  let authority = 'alice';
  let context = 'connection-1';
  const channel = stdChannel();
  const dispatch = (action: StoreAction<unknown>) => {
    state = { agentSessions: agentSessionReducer(state.agentSessions, action) };
    channel.put(action);
  };
  const transport = vi.fn<AgentsClient['rename']>(
    rename ??
      (async (_id, _name, _ws, options) => {
        if (options?.requireRenameReceipt) options.onDispatch();
        return {
          success: true,
          dispatched: true,
          renameOutcome: 'confirmed',
          name: 'Acknowledged',
        };
      }),
  );
  const owner = createAgentRenameSaga({
    rename: transport,
    selectSession: function* (id) {
      return yield* select((s: typeof state) => s.agentSessions.byAgentId[id]);
    },
    selectRevision: function* (id) {
      return yield* select(getAgentRenameRevision, id);
    },
    admission: {
      selectOperations: function* (id) {
        return yield* select(getAgentRenameOperations, id);
      },
      readRevision: (id) => getAgentRenameRevision(state, id),
      isCurrent: (request) =>
        getAgentRenameViewCurrent(state, request) &&
        request.authority === authority &&
        request.context === context,
      canPublish: (request) => request.authority === authority,
      dispatch,
    },
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, owner);
  tasks.push(task);
  const open = (viewId = 'view') =>
    dispatch(agentRenameViewOpened(viewId, 'ws', 'agent', authority, context));
  open();
  const request = (patch: Partial<AgentRenameRequest> = {}) => {
    const all = {
      workspaceId: 'ws',
      agentId: 'agent',
      name: 'Requested',
      requestId: 'request',
      authority,
      context,
      viewId: 'view',
      previousName: state.agentSessions.byAgentId.agent?.name ?? 'Original',
      expectedRevision: getAgentRenameRevision(state, 'agent'),
      ...patch,
    };
    return renameAgentSessionRequested(all.workspaceId, all.agentId, all.name, all);
  };
  return {
    dispatch,
    request,
    open,
    task,
    transport,
    state: () => state,
    receipts: () => getAgentRenameOperations(state, 'agent'),
    identity: (nextAuthority: string, nextContext: string) => {
      authority = nextAuthority;
      context = nextContext;
    },
  };
}

const retirementIngestions = [
  {
    path: 'session update',
    apply: (h: ReturnType<typeof setup>, retiredAt?: string) =>
      h.dispatch(updateSession('agent', { retiredAt })),
  },
  {
    path: 'bulk snapshot',
    apply: (h: ReturnType<typeof setup>, retiredAt?: string) =>
      h.dispatch(bulkUpsertSessions([{ ...row(), retiredAt }])),
  },
  {
    path: 'stored snapshot',
    apply: (h: ReturnType<typeof setup>, retiredAt?: string) =>
      h.dispatch(
        restoreStoredSessions([{ ...h.state().agentSessions.byAgentId.agent, retiredAt }]),
      ),
  },
];

describe('shared explicit agent rename owner', () => {
  it('publishes the actual acknowledged name and explicit marker into the sole session', async () => {
    const h = setup();
    const a = h.request();
    h.dispatch(a);
    await a.promise;
    expect(h.state().agentSessions.byAgentId.agent).toMatchObject({
      name: 'Acknowledged',
      nameExplicitlySet: true,
    });
    expect(h.receipts()[0]).toMatchObject({
      status: 'confirmed',
      acknowledgedName: 'Acknowledged',
    });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['', '  ', 'Original'])('does not send a blank or unchanged name %j', async (name) => {
    const h = setup();
    const a = h.request({ name });
    h.dispatch(a);
    await a.promise;
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.receipts()).toEqual([]);
  });
  it('rejects an ABA change since editing started without wire traffic', async () => {
    const h = setup();
    const a = h.request();
    h.dispatch(updateSession('agent', { name: 'Elsewhere' }));
    h.dispatch(updateSession('agent', { name: 'Original' }));
    h.dispatch(a);
    await expect(a.promise).rejects.toThrow();
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.receipts()[0].status).toBe('failed');
  });
  it.each(retirementIngestions)(
    'revokes an edit permanently when $path retires and restores the agent',
    async ({ apply }) => {
      const h = setup();
      const stale = h.request();
      const revision = getAgentRenameRevision(h.state(), 'agent');
      apply(h, '2026-10-15T13:00:00Z');
      apply(h);
      h.open();
      h.dispatch(stale);
      await expect(stale.promise).rejects.toThrow();
      expect(h.transport).not.toHaveBeenCalled();
      expect(getAgentRenameRevision(h.state(), 'agent')).toBeGreaterThan(revision);
      h.open('restored-view');
      const fresh = h.request({ requestId: 'fresh', viewId: 'restored-view' });
      h.dispatch(fresh);
      await fresh.promise;
      expect(h.transport).toHaveBeenCalledTimes(1);
      expect(h.state().agentSessions.byAgentId.agent.name).toBe('Acknowledged');
    },
  );
  it.each(retirementIngestions)(
    'blocks a held dispatch when $path retires and restores the agent',
    async ({ apply }) => {
      const gate = deferred<void>();
      const wire = vi.fn();
      const h = setup(async (_id, _name, _ws, options) => {
        await gate.promise;
        if (options?.requireRenameReceipt) options.onDispatch();
        wire();
        return { success: true, dispatched: true, renameOutcome: 'confirmed', name: 'Requested' };
      });
      const a = h.request();
      h.dispatch(a);
      apply(h, '2026-10-15T13:00:00Z');
      apply(h);
      gate.resolve();
      await expect(a.promise).rejects.toThrow();
      expect(wire).not.toHaveBeenCalled();
      expect(h.receipts()).toHaveLength(1);
      expect(h.receipts()[0].status).toBe('failed');
      expect(h.state().agentSessions.byAgentId.agent.name).toBe('Original');
    },
  );
  it.each(retirementIngestions)(
    'retains a late receipt without publishing after $path retires and restores the agent',
    async ({ apply }) => {
      const pending = deferred<AgentRenameResult>();
      const h = setup(async (_id, _name, _ws, options) => {
        if (options?.requireRenameReceipt) options.onDispatch();
        return pending.promise;
      });
      const a = h.request();
      h.dispatch(a);
      apply(h, '2026-10-15T13:00:00Z');
      apply(h);
      expect(h.receipts()).toHaveLength(1);
      expect(h.receipts()[0].status).toBe('running');
      pending.resolve({
        success: true,
        dispatched: true,
        renameOutcome: 'confirmed',
        name: 'Late acknowledged',
      });
      await a.promise;
      expect(h.receipts()[0]).toMatchObject({
        status: 'confirmed',
        acknowledgedName: 'Late acknowledged',
      });
      expect(h.state().agentSessions.byAgentId.agent).toMatchObject({
        name: 'Original',
        nameExplicitlySet: false,
      });
    },
  );
  it('revokes an edit when event refresh ingests retirement followed by restoration', async () => {
    const h = setup();
    const a = h.request();
    const getAgent = vi
      .fn()
      .mockResolvedValueOnce({ ...row(), retiredAt: '2026-10-15T13:00:00Z' })
      .mockResolvedValueOnce(row());
    const onBackendReconnected = () => () => {};
    const ownership = createAgentReadOwnership({
      onBackendReconnected,
      getSessionWorkspace: (id) => h.state().agentSessions.byAgentId[id]?.workspaceId,
    });
    const reads = createAgentReadService({
      appStore: {
        get state() {
          return h.state();
        },
        dispatch: h.dispatch,
      },
      getAgent,
      onBackendReconnected,
      ownership,
    });
    try {
      await reads.refreshAgentSessionAfterEvent('agent', 'ws');
      await reads.refreshAgentSessionAfterEvent('agent', 'ws');
      h.open();
      h.dispatch(a);
      await expect(a.promise).rejects.toThrow();
      expect(getAgent.mock.calls).toEqual([
        ['agent', 'ws'],
        ['agent', 'ws'],
      ]);
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.state().agentSessions.byAgentId.agent.retiredAt).toBeUndefined();
    } finally {
      reads.dispose();
      ownership.dispose();
    }
  });
  it.each([
    'release',
    'remove',
    'workspace-remove',
    'workspace-unmount',
    'workspace-delete',
    'reset',
  ])('forever revokes the view after %s including reentry', async (kind) => {
    const h = setup();
    const a = h.request();
    if (kind === 'release') h.dispatch(agentRenameViewReleased('view'));
    if (kind === 'remove') h.dispatch(removeSession('agent'));
    if (kind === 'workspace-remove') h.dispatch(removeWorkspaceSessions('ws'));
    if (kind === 'workspace-unmount') h.dispatch(workspaceUnmounted('ws'));
    if (kind === 'workspace-delete') h.dispatch(workspaceDeleted('ws', ['agent']));
    if (kind === 'reset') h.dispatch(clearAllSessions());
    h.dispatch(bulkUpsertSessions([row()]));
    h.open();
    h.dispatch(a);
    await expect(a.promise).rejects.toThrow();
    expect(h.transport).not.toHaveBeenCalled();
    expect(
      getAgentRenameViewCurrent(h.state(), {
        ...a.payload[3]!,
        workspaceId: 'ws',
        agentId: 'agent',
      }),
    ).toBe(false);
  });
  it('guards the final dispatch boundary after asynchronous preflight', async () => {
    const gate = deferred<void>();
    const wire = vi.fn();
    const h = setup(async (_id, _name, _ws, options) => {
      await gate.promise;
      if (options?.requireRenameReceipt) options.onDispatch();
      wire();
      return { success: true, dispatched: true, renameOutcome: 'confirmed', name: 'Requested' };
    });
    const a = h.request();
    h.dispatch(a);
    h.dispatch(agentRenameViewReleased('view'));
    gate.resolve();
    await expect(a.promise).rejects.toThrow();
    expect(wire).not.toHaveBeenCalled();
    expect(h.receipts()[0].status).toBe('failed');
  });
  it('retains and settles a dispatched receipt after owner cancellation', async () => {
    const pending = deferred<AgentRenameResult>();
    const h = setup(async (_id, _name, _ws, options) => {
      if (options?.requireRenameReceipt) options.onDispatch();
      return pending.promise;
    });
    const a = h.request();
    h.dispatch(a);
    h.task.cancel();
    await expect(a.promise).rejects.toThrow();
    expect(h.receipts()[0].status).toBe('unknown');
    pending.resolve({
      success: true,
      dispatched: true,
      renameOutcome: 'confirmed',
      name: 'Late acknowledged',
    });
    await flush();
    expect(h.receipts()[0].status).toBe('confirmed');
    expect(h.state().agentSessions.byAgentId.agent.name).toBe('Late acknowledged');
  });
  it('never publishes a late receipt into another principal or workspace', async () => {
    const pending = deferred<AgentRenameResult>();
    const h = setup(async (_id, _name, _ws, options) => {
      if (options?.requireRenameReceipt) options.onDispatch();
      return pending.promise;
    });
    const a = h.request();
    h.dispatch(a);
    h.identity('bob', 'connection-2');
    h.dispatch(clearAllSessions());
    h.dispatch(bulkUpsertSessions([{ ...row(), workspaceId: 'other' }]));
    pending.resolve({
      success: true,
      dispatched: true,
      renameOutcome: 'confirmed',
      name: 'Alice name',
    });
    await a.promise;
    expect(h.receipts()[0].status).toBe('confirmed');
    expect(h.state().agentSessions.byAgentId.agent.name).toBe('Original');
  });
  it('keeps a newer authoritative name when an older acknowledgement arrives', async () => {
    const pending = deferred<AgentRenameResult>();
    const h = setup(async (_id, _name, _ws, options) => {
      if (options?.requireRenameReceipt) options.onDispatch();
      return pending.promise;
    });
    const a = h.request();
    h.dispatch(a);
    h.dispatch(bulkUpsertSessions([row('Server newer')]));
    pending.resolve({
      success: true,
      dispatched: true,
      renameOutcome: 'confirmed',
      name: 'Older result',
    });
    await a.promise;
    expect(h.state().agentSessions.byAgentId.agent.name).toBe('Server newer');
    expect(h.receipts()[0].status).toBe('confirmed');
  });
  it('retains unknown across resets and blocks retries only for its original principal', async () => {
    const h = setup(async (_id, _name, _ws, options) => {
      if (options?.requireRenameReceipt) options.onDispatch();
      return { success: false, dispatched: true, renameOutcome: 'unknown' };
    });
    const a = h.request();
    h.dispatch(a);
    await expect(a.promise).rejects.toThrow();
    h.dispatch(clearAllSessions());
    h.dispatch(bulkUpsertSessions([row()]));
    h.open('new-view');
    const retry = h.request({ requestId: 'retry', viewId: 'new-view' });
    h.dispatch(retry);
    await expect(retry.promise).rejects.toThrow();
    expect(h.transport).toHaveBeenCalledTimes(1);
    h.identity('bob', 'connection-2');
    h.open('bob-view');
    const bob = h.request({ requestId: 'bob-request', viewId: 'bob-view' });
    h.dispatch(bob);
    await expect(bob.promise).rejects.toThrow();
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it('does not confirm a custom client success without final dispatch evidence', async () => {
    const h = setup(async () => ({
      success: true,
      dispatched: true,
      renameOutcome: 'confirmed',
      name: 'Unproven',
    }));
    const a = h.request();
    h.dispatch(a);
    await expect(a.promise).rejects.toThrow();
    expect(h.receipts()[0].status).toBe('failed');
    expect(h.state().agentSessions.byAgentId.agent.name).toBe('Original');
  });
  it('rejects concurrent explicit requests and never retries an ambiguous dispatch', async () => {
    const pending = deferred<AgentRenameResult>();
    const h = setup(async (_id, _name, _ws, options) => {
      if (options?.requireRenameReceipt) options.onDispatch();
      return pending.promise;
    });
    const first = h.request();
    h.dispatch(first);
    const second = h.request({ requestId: 'second' });
    h.dispatch(second);
    await expect(second.promise).rejects.toThrow();
    pending.resolve({ success: false, dispatched: true, renameOutcome: 'unknown' });
    await expect(first.promise).rejects.toThrow();
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.receipts()).toHaveLength(1);
    expect(h.receipts()[0].status).toBe('unknown');
  });
  it('cancels before async preflight without sending later', async () => {
    const gate = deferred<void>();
    const wire = vi.fn();
    const h = setup(async (_id, _name, _ws, options) => {
      await gate.promise;
      if (options?.requireRenameReceipt) options.onDispatch();
      wire();
      return { success: true, dispatched: true, renameOutcome: 'confirmed', name: 'Requested' };
    });
    const a = h.request();
    h.dispatch(a);
    h.task.cancel();
    await expect(a.promise).rejects.toThrow();
    gate.resolve();
    await flush();
    expect(wire).not.toHaveBeenCalled();
    expect(h.receipts()[0].status).toBe('failed');
  });
  it('cannot register a view ID after it was released before registration', () => {
    const h = setup();
    h.dispatch(agentRenameViewReleased('retired'));
    h.open('retired');
    expect(
      getAgentRenameViewCurrent(h.state(), {
        viewId: 'retired',
        workspaceId: 'ws',
        agentId: 'agent',
        authority: 'alice',
        context: 'connection-1',
      }),
    ).toBe(false);
  });
  it('rejects a bare legacy request in explicit mode', async () => {
    const h = setup();
    const a = renameAgentSessionRequested('ws', 'agent', 'Name');
    h.dispatch(a);
    await expect(a.promise).rejects.toThrow();
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('bounds known history while retaining all unknown receipts', () => {
    let state: AgentSessionState = agentSessionReducer.initialState;
    for (let i = 0; i < 40; i++) {
      state = agentSessionReducer(
        state,
        agentRenameOperationQueued({
          requestId: String(i),
          workspaceId: 'ws',
          agentId: 'agent',
          name: 'Request',
          previousName: 'Base',
          authority: 'alice',
          context: 'connection',
          viewId: 'view',
          expectedRevision: 0,
          observedRevision: 0,
          status: 'queued',
        }),
      );
      state = agentSessionReducer(
        state,
        agentRenameOperationSettled(String(i), i === 0 ? 'unknown' : 'failed'),
      );
    }
    const operations = getAgentRenameOperations({ agentSessions: state }, 'agent');
    expect(operations).toHaveLength(33);
    expect(operations[0]).toMatchObject({ requestId: '0', status: 'unknown' });
  });
});

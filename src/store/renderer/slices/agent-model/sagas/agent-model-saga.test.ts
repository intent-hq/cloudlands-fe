import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createMockWorkspace } from '../../../../../test/factories/workspace.factory';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
vi.mock('$lib/client/live/backend-transport', () => ({
  observeBackendNodeCapabilities: vi.fn(async () => ({ server: { capabilities: null } })),
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', async () => {
  const { mockInvoke } = await import('$shared/ipc-mock-router');
  return {
    invoke: mockInvoke,
    isElectron: () => false,
    listen: async () => () => {},
    listenSync: () => () => {},
    emit: async () => {},
  };
});
vi.mock('$lib/client', async () => {
  const { LiveAgentsClient } = await import('$lib/client/live/live-agents-client');
  return { appClient: { agents: new LiveAgentsClient() } };
});
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));

import { store } from '../../../store';
import { sagas } from '../../../sagas';
import { backendRequest } from '$lib/client/live/backend-transport';
import { notify } from '$lib/components/patterns/notify';
import { bulkUpsertSessions, updateSession } from '../../agent-session/agent-session-slice';
import {
  providerModelsLoaded,
  providerModelsCacheCleared,
} from '../../provider-models/provider-models-slice';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { connectionsListReceived } from '../../connections/connections-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  selectAgentModelMutations,
  selectAgentModelMutationPending,
} from '../agent-model-selectors';
import { agentModelMutationRequested, agentModelMutationConsumed } from '../agent-model-slice';
import { createAgentModelMutator } from '$lib/components/chat/input/agent-model-mutator';
import {
  applyReasoningEffort,
  markReasoningEffortIntent,
  reconcileAgentReasoningEffort,
  releaseReasoningEffortIntent,
} from '$features/agent/reasoning-effort';
import { agentModelSaga } from './agent-model-saga';
import '../../../seeders/agent-ipc-bridge-seeder';

const agentId = AgentId('agent-one');
const workspaceId = WorkspaceId('amber-forest');
const request = vi.mocked(backendRequest);
const session = () => store.state.agentSessions.byAgentId[agentId];
const pick = (consumerId = 'picker') =>
  createAgentModelMutator({ consumerId, isLocked: () => false });
let dispose: () => void;
let cancels: (() => void)[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function seedCatalog(
  options: {
    warning?: string;
    stale?: boolean;
    models?: { value: string; label: string; effortLevels?: string[] }[];
  } = {},
) {
  store.dispatch(
    providerModelsLoaded(
      'codex',
      { models: [{ value: 'next', label: 'Next', effortLevels: ['low', 'high'] }], ...options },
      store.state.providerModels.clearEpoch,
      workspaceId,
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  dispose = store.init();
  store.dispatch(setWorkspaceEntity(createMockWorkspace({ id: workspaceId, myRole: 'owner' })));
  admitLegacyPrincipal();
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId,
        backendSessionId: null,
        name: 'Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
        provider: 'codex',
        model: 'old',
        reasoningEffort: 'xhigh',
      },
    ]),
  );
  seedCatalog();
  // Exercise actual root registration and reducer composition, not a separately
  // maintained test-only owner list. Unrelated services need no transport here.
  const owners = sagas.filter((saga) => saga === agentModelSaga);
  expect(owners).toHaveLength(1);
  cancels = owners.map((saga) => store.runSaga(saga));
  request.mockImplementation(async (method, params) => {
    if (method === 'agent.setModel')
      return { success: true, modelId: (params as { modelId: string }).modelId };
    if (method === 'agent.update')
      return {
        agent: {
          id: agentId,
          workspaceId,
          name: 'Agent',
          status: 'idle',
          createdAt: '2026-09-01',
          updatedAt: '2026-09-01',
          ...(params as { changes: object }).changes,
        },
      };
    throw new Error(`Unexpected method ${method}`);
  });
});
afterEach(() => {
  cancels.forEach((cancel) => cancel());
  dispose();
});

describe('registered model and effort mutation owner', () => {
  it('keeps bare model/provider identity and reconciles effort through the exact wire', async () => {
    await expect(pick().selectModel(agentId, 'next', workspaceId, 'codex')).resolves.toMatchObject({
      status: 'success',
      modelAccepted: true,
    });
    expect(request.mock.calls).toEqual([
      ['agent.setModel', { agentId, workspaceId, modelId: 'next', providerId: 'codex' }],
      ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'high' } }],
    ]);
    expect(session()).toMatchObject({ model: 'next', provider: 'codex', reasoningEffort: 'high' });
    expect(selectAgentModelMutations.select(store.state, 'picker')).toEqual([]);
  });

  it.each(['missing', 'empty', 'warning', 'stale'] as const)(
    'does not infer no-effort support from a %s catalog',
    async (kind) => {
      if (kind === 'missing') store.dispatch(providerModelsCacheCleared());
      else
        seedCatalog(
          kind === 'empty'
            ? { models: [] }
            : kind === 'warning'
              ? { warning: 'offline' }
              : { stale: true },
        );
      await pick().selectModel(agentId, 'next', workspaceId, 'codex');
      expect(request.mock.calls.map(([method]) => method)).toEqual(['agent.setModel']);
      expect(session().reasoningEffort).toBe('xhigh');
    },
  );

  it('clears effort only when a trustworthy target row explicitly lacks effort support', async () => {
    seedCatalog({ models: [{ value: 'next', label: 'Next' }] });
    await pick().selectModel(agentId, 'next', workspaceId, 'codex');
    expect(request).toHaveBeenLastCalledWith('agent.update', {
      agentId,
      workspaceId,
      changes: { reasoningEffort: null },
    });
    expect(session().reasoningEffort).toBeNull();
  });

  it('keeps the accepted model if subsequent effort reconciliation fails', async () => {
    request
      .mockResolvedValueOnce({ success: true, modelId: 'next' })
      .mockRejectedValueOnce(new Error('effort denied'));
    await expect(pick().selectModel(agentId, 'next', workspaceId, 'codex')).resolves.toMatchObject({
      status: 'failure',
      modelAccepted: true,
    });
    expect(session()).toMatchObject({ model: 'next', reasoningEffort: 'xhigh' });
    expect(notify.error).toHaveBeenCalledTimes(1);
  });

  it('orders a model pick behind an encoder write without overlapping wire requests', async () => {
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise);
    const encoder = applyReasoningEffort(agentId, workspaceId, 'low', 'xhigh', {
      source: 'encoder',
    });
    const model = pick().selectModel(agentId, 'next', workspaceId, 'codex');
    expect(request).toHaveBeenCalledTimes(1);
    expect(selectAgentModelMutationPending.select(store.state, 'picker')).toBe(true);
    held.resolve({ agent: { id: agentId, reasoningEffort: 'low' } });
    await Promise.all([encoder, model]);
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'agent.update',
      'agent.setModel',
    ]);
    expect(session()).toMatchObject({ model: 'next', reasoningEffort: 'low' });
  });

  it.each(['adapter', 'action'] as const)(
    'restores confirmed effort when a queued model pick also rejects (%s)',
    async (caller) => {
      store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));
      const held = deferred<unknown>();
      request.mockReturnValueOnce(held.promise).mockRejectedValueOnce(new Error('model denied'));
      const effort = applyReasoningEffort(agentId, workspaceId, 'low', 'high');
      const model =
        caller === 'adapter'
          ? pick().selectModel(agentId, 'next', workspaceId, 'codex')
          : store.dispatch(
              agentModelMutationRequested({
                requestId: 'queued-pick',
                consumerId: 'picker',
                agentId,
                workspaceId,
                connection: selectPrincipalConnectionContext.select(store.state),
                operation: { kind: 'model', model: 'next', providerId: 'codex', commit: true },
              }),
            );
      expect(session().reasoningEffort).toBe('low');
      expect(request).toHaveBeenCalledTimes(1);

      held.reject(new Error('effort denied'));
      await expect(effort).resolves.toBe(false);
      await expect(model).resolves.toMatchObject({ status: 'failure' });
      expect(request.mock.calls).toEqual([
        ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'low' } }],
        ['agent.setModel', { agentId, workspaceId, modelId: 'next', providerId: 'codex' }],
      ]);
      expect(session()).toMatchObject({ model: 'old', reasoningEffort: 'high' });
      expect(notify.error).toHaveBeenCalledExactlyOnceWith('effort denied');
      if (caller === 'action') {
        expect(selectAgentModelMutations.select(store.state, 'picker')).toMatchObject([
          { requestId: 'queued-pick', status: 'failure' },
        ]);
        store.dispatch(agentModelMutationConsumed('queued-pick', 'picker'));
      }
      expect(store.state.agentModel.mutations.ids).toEqual([]);
    },
  );

  it.each(['success', 'cancelled'] as const)(
    'restores rejected effort before a queued model pick settles as %s',
    async (outcome) => {
      store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));
      const held = deferred<unknown>();
      request.mockReturnValueOnce(held.promise);
      const effort = applyReasoningEffort(agentId, workspaceId, 'low', 'high');
      let live = true;
      const model = pick().selectModel(agentId, 'next', workspaceId, 'codex', () => live);
      live = outcome !== 'cancelled';

      held.reject(new Error('effort denied'));
      await expect(effort).resolves.toBe(false);
      await expect(model).resolves.toMatchObject({ status: outcome });
      expect(session()).toMatchObject({
        model: outcome === 'success' ? 'next' : 'old',
        reasoningEffort: 'high',
      });
      expect(request.mock.calls).toEqual([
        ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'low' } }],
        ...(outcome === 'success'
          ? [['agent.setModel', { agentId, workspaceId, modelId: 'next', providerId: 'codex' }]]
          : []),
      ]);
      expect(notify.error).toHaveBeenCalledExactlyOnceWith('effort denied');
      expect(store.state.agentModel.mutations.ids).toEqual([]);
    },
  );

  it('preserves a newer same-value effort until it rejects behind the leading effort', async () => {
    store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockRejectedValueOnce(new Error('model denied'));
    const leading = applyReasoningEffort(agentId, workspaceId, 'low', 'high');
    const trailing = applyReasoningEffort(agentId, workspaceId, 'low', 'low');
    const model = pick().selectModel(agentId, 'next', workspaceId, 'codex');

    first.reject(new Error('old effort denied'));
    await expect(leading).resolves.toBe(false);
    expect(session().reasoningEffort).toBe('low');
    expect(notify.error).not.toHaveBeenCalled();
    second.reject(new Error('latest effort denied'));
    await expect(trailing).resolves.toBe(false);
    await expect(model).resolves.toMatchObject({ status: 'failure' });
    expect(session()).toMatchObject({ model: 'old', reasoningEffort: 'high' });
    expect(notify.error).toHaveBeenCalledExactlyOnceWith('latest effort denied');
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'agent.update',
      'agent.update',
      'agent.setModel',
    ]);
  });

  it.each(
    (['adapter', 'action'] as const).flatMap((caller) =>
      [false, true].map((released) => ({ caller, released })),
    ),
  )(
    'respects coalescing effort ownership with a queued model ($caller, reservation released: $released)',
    async ({ caller, released }) => {
      store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));
      const held = deferred<unknown>();
      request.mockReturnValueOnce(held.promise).mockRejectedValueOnce(new Error('model denied'));
      const effort = applyReasoningEffort(agentId, workspaceId, 'low', 'high');
      const intent = markReasoningEffortIntent(agentId, workspaceId);
      const model =
        caller === 'adapter'
          ? pick().selectModel(agentId, 'next', workspaceId, 'codex')
          : store.dispatch(
              agentModelMutationRequested({
                requestId: 'queued-pick',
                consumerId: 'picker',
                agentId,
                workspaceId,
                connection: selectPrincipalConnectionContext.select(store.state),
                operation: { kind: 'model', model: 'next', providerId: 'codex', commit: true },
              }),
            );
      if (released) releaseReasoningEffortIntent(agentId, workspaceId, intent);

      held.reject(new Error('effort denied'));
      await expect(effort).resolves.toBe(false);
      await expect(model).resolves.toMatchObject({ status: 'failure' });
      expect(session().reasoningEffort).toBe(released ? 'high' : 'low');
      expect(notify.error.mock.calls).toEqual(released ? [['effort denied']] : []);
      if (!released) {
        await expect(
          applyReasoningEffort(agentId, workspaceId, 'low', 'high', { source: 'encoder', intent }),
        ).resolves.toBe(true);
        expect(session().reasoningEffort).toBe('low');
      }
    },
  );

  it('reconciles an accepted released effort before a queued model rejects', async () => {
    store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise).mockRejectedValueOnce(new Error('model denied'));
    let live = true;
    const intent = markReasoningEffortIntent(agentId, workspaceId);
    const effort = applyReasoningEffort(agentId, workspaceId, 'low', 'high', {
      source: 'encoder',
      intent,
      canSend: () => live,
      canMutate: () => live,
      canReconcileAccepted: () => true,
    });
    const model = pick().selectModel(agentId, 'next', workspaceId, 'codex');
    live = false;
    releaseReasoningEffortIntent(agentId, workspaceId, intent);
    store.dispatch(updateSession(agentId, { reasoningEffort: 'high' }));

    held.resolve({
      agent: {
        id: agentId,
        workspaceId,
        name: 'Agent',
        status: 'idle',
        model: 'old',
        provider: 'codex',
        reasoningEffort: 'low',
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
    });
    await expect(effort).resolves.toBe(true);
    await expect(model).resolves.toMatchObject({ status: 'failure' });
    expect(session()).toMatchObject({ model: 'old', reasoningEffort: 'low' });
    expect(notify.error).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rolls back in-flight model effort reconciliation without undoing the accepted model', async () => {
    const held = deferred<unknown>();
    request
      .mockResolvedValueOnce({ success: true, modelId: 'next' })
      .mockReturnValueOnce(held.promise)
      .mockRejectedValueOnce(new Error('later model denied'));
    const first = pick('first').selectModel(agentId, 'next', workspaceId, 'codex');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(session()).toMatchObject({ model: 'next', reasoningEffort: 'high' });
    const second = pick('second').selectModel(agentId, 'last', workspaceId, 'codex');

    held.reject(new Error('effort denied'));
    await expect(first).resolves.toMatchObject({ status: 'failure', modelAccepted: true });
    await expect(second).resolves.toMatchObject({ status: 'failure' });
    expect(session()).toMatchObject({ model: 'next', reasoningEffort: 'xhigh' });
    expect(request.mock.calls).toEqual([
      ['agent.setModel', { agentId, workspaceId, modelId: 'next', providerId: 'codex' }],
      ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'high' } }],
      ['agent.setModel', { agentId, workspaceId, modelId: 'last', providerId: 'codex' }],
    ]);
  });

  it('serializes two picker consumers and never consumes another consumer result', async () => {
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise);
    const first = pick('one').selectModel(agentId, 'next', workspaceId, 'codex');
    const second = pick('two').selectModel(agentId, 'last', workspaceId, 'codex');
    expect(selectAgentModelMutationPending.select(store.state, 'one')).toBe(true);
    expect(selectAgentModelMutationPending.select(store.state, 'two')).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    held.resolve({ success: true, modelId: 'next' });
    await Promise.all([first, second]);
    expect(request.mock.calls).toEqual([
      ['agent.setModel', { agentId, workspaceId, modelId: 'next', providerId: 'codex' }],
      ['agent.setModel', { agentId, workspaceId, modelId: 'last', providerId: 'codex' }],
    ]);
    expect(session().model).toBe('last');
    expect(store.state.agentModel.mutations.ids).toEqual([]);
  });

  it.each(['connection', 'workspace', 'lock', 'model', 'teardown'] as const)(
    'fences a late model acknowledgement after %s changes',
    async (change) => {
      const held = deferred<unknown>();
      request.mockReturnValueOnce(held.promise);
      let locked = false;
      let live = true;
      const mutator = createAgentModelMutator({ isLocked: () => locked });
      const pending = mutator.selectModel(agentId, 'next', workspaceId, 'codex', () => live);
      if (change === 'connection')
        store.dispatch(
          connectionsListReceived({ connections: [], activeId: 'other', windowBackendId: 'other' }),
        );
      if (change === 'workspace')
        store.dispatch(updateSession(agentId, { workspaceId: WorkspaceId('different') }));
      if (change === 'model') store.dispatch(updateSession(agentId, { model: 'newer' }));
      if (change === 'lock') locked = true;
      if (change === 'teardown') live = false;
      held.resolve({ success: true, modelId: 'next' });
      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(session().model).toBe(change === 'model' ? 'newer' : 'old');
      expect(request).toHaveBeenCalledTimes(1);
      expect(notify.error).not.toHaveBeenCalled();
    },
  );

  it('discards queued reconciliation before changing a newer model effort', async () => {
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise);
    const leading = applyReasoningEffort(agentId, workspaceId, 'low', 'xhigh');
    const queued = reconcileAgentReasoningEffort(agentId, workspaceId, 'low', ['high']);
    store.dispatch(updateSession(agentId, { model: 'external', reasoningEffort: 'medium' }));
    held.resolve({ agent: { id: agentId, reasoningEffort: 'low' } });
    await expect(leading).resolves.toBe(false);
    await expect(queued).resolves.toBe(false);
    expect(session()).toMatchObject({ model: 'external', reasoningEffort: 'medium' });
    expect(request.mock.calls).toEqual([
      ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'low' } }],
    ]);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('does not reconcile an accepted effort into a different workspace', async () => {
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise);
    const writing = applyReasoningEffort(agentId, workspaceId, 'low', 'xhigh', {
      source: 'encoder',
      canReconcileAccepted: () => true,
    });
    store.dispatch(
      updateSession(agentId, {
        workspaceId: WorkspaceId('different'),
        reasoningEffort: 'medium',
      }),
    );
    held.resolve({ agent: { id: agentId, reasoningEffort: 'low' } });
    await expect(writing).resolves.toBe(false);
    expect(session().reasoningEffort).toBe('medium');
    expect(request.mock.calls).toEqual([
      ['agent.update', { agentId, workspaceId, changes: { reasoningEffort: 'low' } }],
    ]);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('settles pending and queued requests on owner cancellation and permits a clean restart', async () => {
    const held = deferred<unknown>();
    request.mockReturnValueOnce(held.promise);
    const create = (requestId: string) =>
      agentModelMutationRequested({
        requestId,
        consumerId: 'ui',
        agentId,
        workspaceId,
        connection: selectPrincipalConnectionContext.select(store.state),
        operation: { kind: 'model', model: 'next', providerId: 'codex', commit: true },
      });
    const first = create('first');
    const second = create('second');
    store.dispatch(first);
    store.dispatch(second);
    cancels.forEach((cancel) => cancel());
    await expect(first.promise).resolves.toEqual({ status: 'cancelled' });
    await expect(second.promise).resolves.toEqual({ status: 'cancelled' });
    store.dispatch(agentModelMutationConsumed('first', 'wrong'));
    expect(selectAgentModelMutations.select(store.state, 'ui')).toHaveLength(2);
    store.dispatch(agentModelMutationConsumed('first', 'ui'));
    store.dispatch(agentModelMutationConsumed('second', 'ui'));
    cancels = [store.runSaga(agentModelSaga)];
    await pick().selectModel(agentId, 'last', workspaceId, 'codex');
    held.resolve({ success: true, modelId: 'next' });
    await Promise.resolve();
    expect(session().model).toBe('last');
    expect(store.state.agentModel.mutations.ids).toEqual([]);
  });
});

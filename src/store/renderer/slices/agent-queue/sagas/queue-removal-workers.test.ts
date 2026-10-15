import { createAgentQueueReadService } from '../../../../../features/agent/agent-queue-read-service-factory';
import { createSubmissionEvidence } from '../../../../../features/agent/submission-evidence-factory';
import type { SubmissionProjectionState } from '../../pending-submissions/pending-submissions-projections';
import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { select, type SagaGenerator } from 'typed-redux-saga';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import { createBackendChatCommands } from '../../../../../lib/client/live/backend-chat-commands';
import { createQueueRemovalWorkers } from './queue-removal-workers';
import {
  agentQueueReducer,
  initialState,
  replaceAgentQueue,
  clearAgentQueue,
  queuedMessageMutationRequested,
  queuedMessageMutationsReleased,
} from '../agent-queue-slice';
import {
  getAgentQueueMessages,
  getQueuedMessageMutation,
  getQueueRemovalUncertain,
} from '../agent-queue-projections';
import type { QueuedMessageMutationRequest } from '../agent-queue-types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

const scope = {
  agentId: 'a',
  workspaceId: 'w',
  authority: 'backend-1',
  principalId: 'p1',
  participation: 'owner',
  owner: 'runtime',
  lifetime: 'admission-1',
};
const row = { id: 'q', content: 'keep this', queuedAt: '2026-10-15T00:00:00Z', position: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const stateShape = (agentQueue = initialState) => ({ agentQueue });
type State = ReturnType<typeof stateShape>;
function reader<A extends unknown[], R>(projection: (state: State, ...args: A) => R) {
  return {
    *effect(...args: A): SagaGenerator<R> {
      return yield* select(projection, ...args);
    },
  };
}
const mutationReader = reader(getQueuedMessageMutation);
const uncertainReader = reader(getQueueRemovalUncertain);
const messagesReader = reader(getAgentQueueMessages);

function harness() {
  let state = stateShape(agentQueueReducer(initialState, replaceAgentQueue('a', [row], 'w')));
  let principal = 'p1';
  let backendId = 'daemon-1';
  let authority = 'connection-1';
  let generation = 1;
  let sequence = 0;
  let blocked = false;
  let releaseView = false;
  let preparation: Promise<void> | undefined;
  const responses: ReturnType<typeof deferred<unknown>>[] = [];
  const wire = vi.fn(async () => {
    const gate = deferred<unknown>();
    responses.push(gate);
    return gate.promise;
  });
  const backend = createBackendChatCommands(
    async <T>(
      _method: string,
      _params?: unknown,
      options?: { onDispatch?: () => void },
    ): Promise<T> => {
      if (preparation) await preparation;
      options?.onDispatch?.();
      return (await wire()) as T;
    },
  );
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof agentQueueReducer>[1]) => {
    state = stateShape(agentQueueReducer(state.agentQueue, action));
    channel.put(action);
    return action;
  };
  const hydrate = vi.fn(async () => undefined);
  const owner = createQueueRemovalWorkers({
    agents: backend,
    dispatch,
    captureAuthority(request) {
      if (
        request.removalBackendId !== backendId ||
        request.removalScope?.authority !== authority ||
        request.removalScope?.principalId !== principal ||
        request.consumerId !== `view-${generation}` ||
        releaseView
      )
        return;
      const captured = generation;
      return {
        isCurrent: () =>
          !releaseView &&
          generation === captured &&
          request.removalBackendId === backendId &&
          request.removalScope?.authority === authority &&
          principal === request.removalScope?.principalId,
        canPublish: () =>
          request.removalBackendId === backendId &&
          request.removalScope?.authority === authority &&
          principal === request.removalScope?.principalId,
      };
    },
    selectQueuedMessageMutation: mutationReader,
    selectQueueRemovalUncertain: uncertainReader,
    selectAgentQueueMessages: messagesReader,
    selectQueueMutationBlocked: {
      *effect() {
        return blocked;
      },
    },
    hydrateAgentQueue: hydrate,
    getAgentQueueEventSnapshotSeq: () => sequence,
    noteAgentQueueEventSnapshotApplied: () => {
      sequence++;
    },
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, function* () {
    yield* takeEveryByContextFIFO(
      queuedMessageMutationRequested,
      (action) => {
        owner.capture(action);
        return action.payload[0].agentId;
      },
      owner.handleRemove,
      {},
    );
  });
  const request = (
    id = 'r1',
    messageId = 'q',
    override: Partial<QueuedMessageMutationRequest> = {},
  ) => {
    const action = queuedMessageMutationRequested({
      requestId: id,
      consumerId: `view-${generation}`,
      workspaceId: 'w',
      agentId: 'a',
      messageId,
      operation: { kind: 'remove' },
      removalScope: { ...scope, authority, principalId: principal },
      removalBackendId: backendId,
      ...override,
    });
    dispatch(action);
    return action;
  };
  return {
    wire,
    responses,
    hydrate,
    request,
    dispatch,
    task,
    entry: (id = 'r1') => getItem(state.agentQueue.mutations, id),
    rows: () =>
      state.agentQueue.byAgentId.a ? getItems(state.agentQueue.byAgentId.a.messages) : [],
    setPreparation: (gate: Promise<void>) => {
      preparation = gate;
    },
    block: () => {
      blocked = true;
    },
    leave() {
      releaseView = true;
      dispatch(queuedMessageMutationsReleased(`view-${generation}`));
      generation++;
    },
    enter() {
      releaseView = false;
    },
    reconnect(nextBackendId = backendId) {
      backendId = nextBackendId;
      authority += '-next';
      generation++;
    },
    principal: (value: string) => {
      principal = value;
    },
    snapshot(messages: (typeof row)[]) {
      sequence++;
      dispatch(replaceAgentQueue('a', messages, 'w'));
    },
    stop: async () => {
      task.cancel();
      await task.toPromise();
    },
  };
}

describe('canonical queue removal owner', () => {
  it('retains the row while pending, and acknowledges only no-longer-queued', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    expect(run.rows()).toEqual([row]);
    run.responses[0].resolve({ success: true });
    await vi.waitFor(() =>
      expect(run.entry()).toMatchObject({
        status: 'succeeded',
        removalOutcome: 'no-longer-queued',
      }),
    );
    expect(run.rows()).toEqual([]);
    run.snapshot([row]);
    expect(run.rows()).toEqual([row]);
    await run.stop();
  });
  it.each([new Error('offline'), Object.assign(new Error('denied'), { rpcCode: -32602 })])(
    'retains actual rows on failed or uncertain removal',
    async (error) => {
      const run = harness();
      run.request();
      await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
      run.responses[0].reject(error);
      await vi.waitFor(() => expect(run.entry()?.status).toBe('failed'));
      expect(run.entry()?.removalOutcome).toBe('rpcCode' in error ? 'failed' : 'unknown');
      expect(run.rows()).toEqual([row]);
      expect(run.hydrate).toHaveBeenCalledExactlyOnceWith('a', 'w');
      await run.stop();
    },
  );
  it.each([undefined, {}, { success: false }])(
    'retains unknown for malformed or missing receipts: %j',
    async (receipt) => {
      const run = harness();
      run.request();
      await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
      run.responses[0].resolve(receipt);
      await vi.waitFor(() =>
        expect(run.entry()).toMatchObject({ status: 'failed', removalOutcome: 'unknown' }),
      );
      expect(run.rows()).toEqual([row]);
      await run.stop();
    },
  );
  it('checks canonical submission blocking at execution', async () => {
    const run = harness();
    run.block();
    run.request();
    await vi.waitFor(() =>
      expect(run.entry()).toMatchObject({ status: 'failed', removalOutcome: 'failed' }),
    );
    expect(run.wire).not.toHaveBeenCalled();
    await run.stop();
  });
  it('rejects an original principal at intake instead of adopting the current principal', async () => {
    const run = harness();
    run.principal('p2');
    run.request('r1', 'q', { removalScope: scope });
    await vi.waitFor(() => expect(run.entry()?.status).toBe('cancelled'));
    expect(run.wire).not.toHaveBeenCalled();
    await run.stop();
  });
  it('never revives final dispatch authority when a view leaves and re-enters during preparation', async () => {
    const run = harness();
    const gate = deferred<void>();
    run.setPreparation(gate.promise);
    run.request();
    run.leave();
    run.enter();
    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(run.wire).not.toHaveBeenCalled();
    expect(run.entry()).toBeUndefined();
    await run.stop();
  });
  it('preserves an uncertain sent receipt across leave, workspace reset and re-entry without replay', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.leave();
    run.dispatch(workspaceUnmounted('w'));
    run.dispatch(clearAgentQueue('a'));
    run.responses[0].reject(new Error('lost receipt'));
    await vi.waitFor(() =>
      expect(run.entry()).toMatchObject({ removalDispatched: true, removalOutcome: 'unknown' }),
    );
    run.enter();
    run.snapshot([row]);
    run.request('r2');
    await vi.waitFor(() =>
      expect(run.entry('r2')).toMatchObject({ status: 'failed', removalOutcome: 'unknown' }),
    );
    expect(run.wire).toHaveBeenCalledOnce();
    await run.stop();
  });
  it('keeps an unknown receipt attached to the stable backend through reconnect generations', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.responses[0].reject(new Error('lost during reconnect'));
    await vi.waitFor(() => expect(run.entry()?.removalOutcome).toBe('unknown'));
    run.leave();
    run.reconnect();
    run.enter();
    run.snapshot([row]);
    run.request('same-backend');
    await vi.waitFor(() =>
      expect(run.entry('same-backend')).toMatchObject({
        status: 'failed',
        removalOutcome: 'unknown',
      }),
    );
    expect(run.entry('same-backend')?.removalScope?.authority).not.toBe(
      run.entry()?.removalScope?.authority,
    );
    expect(run.wire).toHaveBeenCalledOnce();
    run.leave();
    run.reconnect('daemon-2');
    run.enter();
    run.snapshot([row]);
    run.request('other-backend');
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledTimes(2));
    run.responses[1].resolve({ success: true });
    await vi.waitFor(() =>
      expect(run.entry('other-backend')?.removalOutcome).toBe('no-longer-queued'),
    );
    expect(run.entry()?.removalOutcome).toBe('unknown');
    await run.stop();
  });

  it('rejects a queued old view intent after leave and re-entry', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.request('queued-old', 'another');
    run.leave();
    run.enter();
    run.responses[0].resolve({ success: true });
    await vi.waitFor(() => expect(run.entry()?.status).toBe('succeeded'));
    expect(run.entry('queued-old')).toBeUndefined();
    expect(run.wire).toHaveBeenCalledOnce();
    await run.stop();
  });
  it('rejects principal changes at final dispatch after asynchronous preparation', async () => {
    const run = harness();
    const gate = deferred<void>();
    run.setPreparation(gate.promise);
    run.request();
    run.principal('p2');
    gate.resolve();
    await vi.waitFor(() => expect(run.entry()?.status).toBe('failed'));
    expect(run.entry()?.removalDispatched).toBeUndefined();
    expect(run.wire).not.toHaveBeenCalled();
    expect(run.rows()).toEqual([row]);
    await run.stop();
  });
  it('records a late original receipt without publishing into another principal', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.principal('p2');
    run.snapshot([{ ...row, content: 'new principal row' }]);
    run.responses[0].resolve({ success: true });
    await vi.waitFor(() => expect(run.entry()?.status).toBe('succeeded'));
    expect(run.entry()?.removalScope?.principalId).toBe('p1');
    expect(run.rows()).toMatchObject([{ content: 'new principal row' }]);
    expect(run.hydrate).not.toHaveBeenCalled();
    await run.stop();
  });
  it('lets a newer authoritative event win over an older receipt', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.snapshot([{ ...row, content: 'newer server snapshot' }]);
    run.responses[0].resolve({ success: true });
    await vi.waitFor(() => expect(run.entry()?.status).toBe('succeeded'));
    expect(run.rows()).toMatchObject([{ content: 'newer server snapshot' }]);
    await run.stop();
  });
  it('does not send a removal for an already drained row', async () => {
    const run = harness();
    run.snapshot([]);
    run.request();
    await vi.waitFor(() =>
      expect(run.entry()).toMatchObject({
        status: 'succeeded',
        removalOutcome: 'no-longer-queued',
      }),
    );
    expect(run.wire).not.toHaveBeenCalled();
    await run.stop();
  });
  it('does not let duplicate request IDs cancel or redirect the original in-flight write', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    run.request('r1', 'different-row');
    expect(run.entry()?.messageId).toBe('q');
    run.responses[0].resolve({ success: true });
    await vi.waitFor(() =>
      expect(run.entry()).toMatchObject({ status: 'succeeded', messageId: 'q' }),
    );
    expect(run.wire).toHaveBeenCalledOnce();
    await run.stop();
  });
  it('settles cancelled sent work as unknown and does not let a late response change it', async () => {
    const run = harness();
    run.request();
    await vi.waitFor(() => expect(run.wire).toHaveBeenCalledOnce());
    await run.stop();
    expect(run.entry()).toMatchObject({ status: 'failed', removalOutcome: 'unknown' });
    run.responses[0].resolve({ success: true });
    await Promise.resolve();
    expect(run.rows()).toEqual([row]);
  });
});

it('fences an older queue read when removal succeeds and trailing reconciliation fails', async () => {
  let serverQueue = [row];
  let state = {
    ...stateShape(agentQueueReducer(initialState, replaceAgentQueue('a', [row], 'w'))),
    pendingSubmissions: { byAgentId: {} },
    agentSessions: { byAgentId: {} },
  };
  const dispatch = (action: Parameters<typeof agentQueueReducer>[1]) => {
    state = { ...state, agentQueue: agentQueueReducer(state.agentQueue, action) };
    return action;
  };
  const oldReadGate = deferred<void>();
  let reads = 0;
  const backend = createBackendChatCommands(
    async <T>(
      method: string,
      params?: unknown,
      options?: { onDispatch?: () => void },
    ): Promise<T> => {
      options?.onDispatch?.();
      if (method === 'agent.getQueue') {
        expect(params).toEqual({ agentId: 'a', workspaceId: 'w' });
        if (++reads > 1) throw new Error('reconciliation temporarily unavailable');
        const snapshot = [...serverQueue];
        await oldReadGate.promise;
        return { success: true, queue: snapshot } as T;
      }
      expect(method).toBe('agent.removeQueuedMessage');
      expect(params).toEqual({ agentId: 'a', workspaceId: 'w', messageId: 'q' });
      serverQueue = [];
      return { success: true } as T;
    },
    { strictQueue: true },
  );
  const appStore = {
    get state() {
      return state as SubmissionProjectionState;
    },
    dispatch,
  };
  const evidence = createSubmissionEvidence(appStore);
  const queueReads = createAgentQueueReadService({
    appStore,
    agents: backend,
    claimAgentReadOwnership: () => ({ key: 'view-one', isCurrent: () => true, bindWorkspace() {} }),
    onBackendReconnected: () => () => {},
    beginSubmissionRead: evidence.beginSubmissionRead,
  });
  const removal = createQueueRemovalWorkers({
    agents: backend,
    dispatch,
    captureAuthority: () => ({ isCurrent: () => true, canPublish: () => true }),
    selectQueuedMessageMutation: mutationReader,
    selectQueueRemovalUncertain: uncertainReader,
    selectAgentQueueMessages: messagesReader,
    selectQueueMutationBlocked: {
      *effect() {
        return false;
      },
    },
    hydrateAgentQueue: queueReads.hydrateAgentQueue,
    getAgentQueueEventSnapshotSeq: queueReads.getAgentQueueEventSnapshotSeq,
    noteAgentQueueEventSnapshotApplied: queueReads.noteAgentQueueEventSnapshotApplied,
  });
  const oldRead = queueReads.hydrateAgentQueue('a', 'w');
  const action = queuedMessageMutationRequested({
    requestId: 'removal',
    consumerId: 'view-one',
    agentId: 'a',
    workspaceId: 'w',
    messageId: 'q',
    operation: { kind: 'remove' },
    removalBackendId: 'daemon-one',
    removalScope: scope,
  });
  dispatch(action);
  removal.capture(action);
  const task = runSaga({ dispatch, getState: () => state }, removal.handleRemove, action);
  try {
    await vi.waitFor(() =>
      expect(getQueuedMessageMutation(state, 'removal')?.removalOutcome).toBe('no-longer-queued'),
    );
    expect(getAgentQueueMessages(state, 'a', 'w')).toEqual([]);
    oldReadGate.resolve();
    await oldRead;
    await task.toPromise();
    expect(reads).toBe(2);
    expect(serverQueue).toEqual([]);
    expect(state.agentQueue.byAgentId.a.error).toBe('reconciliation temporarily unavailable');
    expect(getAgentQueueMessages(state, 'a', 'w')).toEqual([]);
  } finally {
    oldReadGate.resolve();
    task.cancel();
    queueReads.dispose();
  }
});

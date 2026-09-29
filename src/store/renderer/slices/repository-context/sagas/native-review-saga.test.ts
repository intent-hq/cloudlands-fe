import { NativeReviewPreparationSchema } from '$shared/types/native-review';
import { NativeReviewObservationSchema } from '$shared/types/native-review-operation';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import fixture from '$shared/types/__fixtures__/native-review-v1.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { StreamingStore } from '@augmentcode/themis/streaming-store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LiveWorkspacesClient } from '$lib/client/live/live-workspaces-client';
import { appClient } from '$lib/client';
import type {
  NativeReviewOwner,
  NativeReviewSession,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import type { StoreState } from '../../../types';
import { repositoryContextSaga } from './repository-context-saga';
import { selectNativeReviewForOwner } from '../repository-context-selectors';
import {
  repositoryContextReducer,
  nativeReviewEditRequested,
  nativeReviewConfirmRequested,
  nativeReviewEditEnded,
  nativeReviewEditStarted,
  nativeReviewCommandStarted,
  repositoryContextRetired,
  nativeReviewReconcileRequested,
  nativeReviewObserved,
} from '../repository-context-slice';
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: {
      beginNativeReview: vi.fn(),
      beginRepositorySelectionEdit: vi.fn(),
      observeRepositoryContext: vi.fn(),
    },
  },
}));
vi.mock('../../principal/principal-selectors', () => ({
  selectPrincipalAdmissionContext: {
    select: (s: { admission: string | null }) => s.admission,
    effect: function* () {
      return yield* select((s: { admission: string | null }) => s.admission);
    },
  },
}));
vi.mock('../../workspace/workspace-selectors', () => ({
  selectWorkspaceHostOperationContext: {
    select: (s: { hostContext: string | null }) => s.hostContext,
    effect: function* () {
      return yield* select((s: { hostContext: string | null }) => s.hostContext);
    },
  },
}));
const root = { workspaceId: 'equal-id', kind: 'primary' as const },
  owner = { root, attemptId: 'edit-1', hostContext: 'host-A', admission: 'A/member' };
const input = {
  workspaceId: root.workspaceId,
  action: 'create-pr' as const,
  review: { root, choice: { kind: 'saved' as const } },
};
const preview = {
  ...fixture.prepare,
  reviewPreparation: NativeReviewPreparationSchema.parse({
    ...fixture.prepare.reviewPreparation,
    root,
  }),
  root,
  expiresAfterMs: 300000 as const,
};
const execution = {
  ...fixture.execute.reviewExecution,
  preparation: preview.reviewPreparation,
  gitReceipts: [{ stage: 'commit' as const, commitHash: 'actual-B' }],
  outcome: {
    status: 'failed' as const,
    stage: 'create-pr' as const,
    code: null,
    message: 'refused',
  },
};
const observation = NativeReviewObservationSchema.parse({
  current: false,
  uncertain: false,
  reconciliation: null,
  execute: {
    operationId: execution.preparation.operationId,
    root,
    state: 'settled' as const,
    success: false,
    steps: [],
    result: { commitHash: 'actual-B' },
    reviewExecution: execution,
  },
});
const tasks: Task[] = [];
const disposers: Array<() => void> = [];
afterEach(() => {
  tasks.splice(0).forEach((t) => t.cancel());
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
  vi.clearAllMocks();
});
function harness() {
  let state = {
    hostContext: 'host-A' as string | null,
    admission: 'A/member' as string | null,
    repositoryContext: repositoryContextReducer(undefined, { type: 'init' }),
  };
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  let onReduce: ((action: { type: string }) => void) | undefined;
  let onAction: ((action: { type: string }) => void) | undefined;
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = {
      ...state,
      repositoryContext: repositoryContextReducer(state.repositoryContext, action as never),
    };
    listeners.forEach((l) => l());
    onReduce?.(action);
    channel.put(action);
    onAction?.(action);
    return action;
  };
  const reduxStore = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  tasks.push(
    runSaga(
      {
        channel,
        dispatch,
        getState: reduxStore.getState,
        context: {
          reduxStore,
          reportRuntimeError: (error: unknown) => {
            throw error;
          },
        },
      },
      repositoryContextSaga,
    ),
  );
  let retirement: (kind: NativeReviewRetirement) => void = () => {};
  const session: NativeReviewSession = {
    preview,
    onRetired: vi.fn(() => vi.fn()),
    confirm: vi.fn(async () => observation),
    reconcile: vi.fn(async () => observation),
    release: vi.fn(async () => {}),
  };
  vi.mocked(appClient.workspaces.beginNativeReview).mockImplementation(
    async (_request, _input, handler) => {
      retirement = handler;
      return session;
    },
  );
  return {
    dispatch,
    session,
    retire: (kind: NativeReviewRetirement) => retirement(kind),
    view: (edit: NativeReviewOwner = owner) =>
      selectNativeReviewForOwner.select(state as unknown as StoreState, edit),
    retained: (edit: NativeReviewOwner = owner) =>
      state.repositoryContext.nativeReviewAttempts
        ? getItem(state.repositoryContext.nativeReviewAttempts, edit.attemptId)
        : undefined,
    host(value: string | null) {
      state = { ...state, hostContext: value };
      listeners.forEach((l) => l());
    },
    principal(value: string | null) {
      state = { ...state, admission: value };
      listeners.forEach((l) => l());
    },
    onReduce(fn: typeof onReduce) {
      onReduce = fn;
    },
    onAction(fn: typeof onAction) {
      onAction = fn;
    },
  };
}
async function start(h: ReturnType<typeof harness>, edit = owner) {
  h.dispatch(
    nativeReviewEditRequested(edit, {
      ...input,
      workspaceId: edit.root.workspaceId,
      review: { ...input.review, root: edit.root },
    }),
  );
  await vi.waitFor(() => expect(h.view(edit)?.status).toBe('ready'));
}
describe('actual root saga native review ownership', () => {
  it('prepares before confirmation and preserves genuine failed commit receipts separately', async () => {
    const h = harness();
    await start(h);
    expect(h.session.confirm).not.toHaveBeenCalled();
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    await vi.waitFor(() => expect(h.view()?.observation).toEqual(observation));
    h.dispatch(repositoryContextRetired(root.workspaceId, 'read-only'));
    expect(h.view()?.observation?.execute?.reviewExecution?.gitReceipts).toEqual(
      execution.gitReceipts,
    );
    h.dispatch(nativeReviewEditEnded(owner));
    await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
    expect(h.view()).toBeNull();
    expect(h.retained()?.observation?.execute).toEqual(observation.execute);
    h.dispatch(nativeReviewEditRequested(owner, input));
    await Promise.resolve();
    expect(appClient.workspaces.beginNativeReview).toHaveBeenCalledOnce();
  });
  it('claims once before reentrant duplicate confirmation', async () => {
    const h = harness();
    await start(h);
    h.onAction((action) => {
      if (action.type === nativeReviewCommandStarted.type)
        h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'different' }));
    });
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    await vi.waitFor(() => expect(h.session.confirm).toHaveBeenCalledOnce());
    expect(h.session.confirm).toHaveBeenCalledWith({ prTitle: 'T' });
  });
  it('reconciles only the original session after normal retirement, without another command', async () => {
    const h = harness();
    await start(h);
    h.retire('admission');
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    h.dispatch(nativeReviewReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
    expect(h.session.confirm).not.toHaveBeenCalled();
    expect(h.view()?.status).toBe('retired');
  });
  it('hides closed presentation but retains the late original outcome without reacquisition', async () => {
    const h = harness();
    let settle!: (value: typeof observation) => void;
    vi.mocked(h.session.confirm).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    await start(h);
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    await vi.waitFor(() => expect(h.session.confirm).toHaveBeenCalledOnce());
    h.retire('closed');
    expect(h.view()).toBeNull();
    h.dispatch(nativeReviewEditRequested(owner, input));
    settle(observation);
    await vi.waitFor(() => expect(h.retained()?.observation?.execute).toEqual(observation.execute));
    expect(appClient.workspaces.beginNativeReview).toHaveBeenCalledOnce();
    expect(h.view()).toBeNull();
  });
  it.each(['host', 'principal'] as const)(
    'clears on %s replacement and rejects late/old commands',
    async (change) => {
      const h = harness();
      await start(h);
      h[change]('B');
      await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
      h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
      expect(h.view()).toBeNull();
      expect(h.session.confirm).not.toHaveBeenCalled();
    },
  );
  it('does not adopt another root or an old descriptor into a fresh same-root attempt', async () => {
    const h = harness();
    await start(h);
    h.dispatch(nativeReviewEditEnded(owner));
    const fresh = { ...owner, attemptId: 'fresh' };
    await start(h, fresh);
    h.dispatch(nativeReviewEditRequested(owner, input));
    await Promise.resolve();
    expect(h.view(fresh)?.status).toBe('ready');
    expect(h.view(owner)).toBeNull();
    h.dispatch(
      nativeReviewConfirmRequested(
        { ...fresh, root: { ...root, kind: 'registered', gitRootId: 'wrong' } },
        { prTitle: 'T' },
      ),
    );
    expect(h.session.confirm).not.toHaveBeenCalled();
  });
  it('disposes a late preparation after unmount/end without transferring it to another attempt', async () => {
    const h = harness();
    let opened!: (value: NativeReviewSession) => void;
    vi.mocked(appClient.workspaces.beginNativeReview).mockImplementation(
      () =>
        new Promise((resolve) => {
          opened = resolve;
        }),
    );
    h.dispatch(nativeReviewEditRequested(owner, input));
    await vi.waitFor(() => expect(appClient.workspaces.beginNativeReview).toHaveBeenCalledOnce());
    h.dispatch(nativeReviewEditEnded(owner));
    opened(h.session);
    await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
    expect(h.view()).toBeNull();
  });
  it('refuses unavailable capture, mismatched root and absent host admission without ordinary calls', async () => {
    const h = harness();
    h.dispatch(nativeReviewEditRequested(owner, { ...input, workspaceId: 'wrong' }));
    expect(appClient.workspaces.beginNativeReview).not.toHaveBeenCalled();
    vi.mocked(appClient.workspaces.beginNativeReview).mockRejectedValue(new Error('forbidden'));
    h.dispatch(nativeReviewEditRequested(owner, input));
    await vi.waitFor(() => expect(h.view()?.status).toBe('unavailable'));
    h.dispatch(nativeReviewConfirmRequested(owner, {}));
    expect(h.session.confirm).not.toHaveBeenCalled();
  });
  it('stops before preparation on reentrant demand end during started dispatch', async () => {
    const h = harness();
    h.onAction((action) => {
      if (action.type === nativeReviewEditStarted.type) h.dispatch(nativeReviewEditEnded(owner));
    });
    h.dispatch(nativeReviewEditRequested(owner, input));
    await Promise.resolve();
    expect(appClient.workspaces.beginNativeReview).not.toHaveBeenCalled();
    expect(h.view()).toBeNull();
  });
  it('stops dispatch when a real reducer subscriber ends the original attempt before command admission', async () => {
    const h = harness();
    await start(h);
    h.onReduce((action) => {
      if (action.type === nativeReviewCommandStarted.type) h.dispatch(nativeReviewEditEnded(owner));
    });
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    await Promise.resolve();
    expect(h.session.confirm).not.toHaveBeenCalled();
    expect(h.view()).toBeNull();
  });
  it('closes unmounted native state synchronously before dispatch without dropping retained receipts', async () => {
    const h = harness();
    await start(h);
    h.onReduce((action) => {
      if (action.type === nativeReviewCommandStarted.type)
        h.dispatch(workspaceUnmounted(WorkspaceId(root.workspaceId)));
    });
    h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'T' }));
    await Promise.resolve();
    expect(h.session.confirm).not.toHaveBeenCalled();
    expect(h.view()).toBeNull();
  });
});

const nativeChannels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
function installNativeBridge(mode: 'execute' | 'reconciliation' = 'execute') {
  const previous = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const listeners = new Map<string, Map<string, (value: unknown) => void>>();
  let nextListener = 0;
  let rejectReconcile = false;
  const pending = {
    operationId: execution.preparation.operationId,
    root,
    state: 'pending' as const,
    success: false,
    steps: [],
  };
  const reconciled = NativeReviewObservationSchema.parse({
    current: false,
    uncertain: false,
    execute: pending,
    reconciliation: {
      operationId: execution.preparation.operationId,
      root,
      state: 'settled',
      reviewExecution: execution,
    },
  });
  const api = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === nativeChannels.PREPARE)
        return { ok: true, result: { id: 'original-local-id', preview } };
      if (channel === nativeChannels.EXECUTE)
        return {
          ok: true,
          result:
            mode === 'execute'
              ? observation
              : { current: true, uncertain: true, execute: pending, reconciliation: null },
        };
      if (channel === nativeChannels.RECONCILE) {
        if (rejectReconcile) throw new Error('Controlled IPC rejection');
        return { ok: true, result: reconciled };
      }
      if (channel === nativeChannels.RELEASE) return { ok: true, result: { released: true } };
      throw new Error(`Unexpected IPC channel: ${channel}`);
    }),
    on(channel: string, handler: (value: unknown) => void) {
      const id = String(++nextListener);
      const handlers = listeners.get(channel) ?? new Map();
      handlers.set(id, handler);
      listeners.set(channel, handlers);
      return id;
    },
    offById(channel: string, id: string) {
      listeners.get(channel)?.delete(id);
    },
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: api });
  disposers.push(() => {
    if (previous) Object.defineProperty(window, 'electronAPI', previous);
    else Reflect.deleteProperty(window, 'electronAPI');
  });
  return {
    api,
    reconciled,
    retire() {
      for (const handler of listeners.get(nativeChannels.RETIRED)?.values() ?? [])
        handler({ id: 'original-local-id', kind: 'admission' });
    },
    rejectReconciles() {
      rejectReconcile = true;
    },
  };
}

function liveStoreHarness() {
  const live = new LiveWorkspacesClient();
  // Forward through the production facade; only correlation inputs and preload are controlled.
  vi.mocked(appClient.workspaces.beginNativeReview).mockImplementation(
    live.beginNativeReview.bind(live),
  );
  let observed = 0;
  const store = new StreamingStore(
    {
      repositoryContext: repositoryContextReducer,
      admission: () => owner.admission,
      hostContext: () => owner.hostContext,
    },
    () => (next) => (action) => {
      const result = next(action);
      if (
        action &&
        typeof action === 'object' &&
        'type' in action &&
        action.type === nativeReviewObserved.type
      )
        observed += 1;
      return result;
    },
  );
  store.init();
  const stop = store.runSaga(repositoryContextSaga);
  disposers.push(() => {
    stop();
    store.dispose();
  });
  return {
    dispatch: store.dispatch,
    observed: () => observed,
    view: (edit: NativeReviewOwner = owner) =>
      selectNativeReviewForOwner.select(store.state as unknown as StoreState, edit),
    retained: (edit: NativeReviewOwner = owner) =>
      store.state.repositoryContext.nativeReviewAttempts
        ? getItem(store.state.repositoryContext.nativeReviewAttempts, edit.attemptId)
        : undefined,
  };
}

async function startLive(h: ReturnType<typeof liveStoreHarness>, edit = owner) {
  h.dispatch(nativeReviewEditRequested(edit, input));
  await vi.waitFor(() => expect(h.view(edit)?.status).toBe('ready'));
}

async function confirmLive(h: ReturnType<typeof liveStoreHarness>) {
  h.dispatch(nativeReviewConfirmRequested(owner, { prTitle: 'Original title' }));
  await vi.waitFor(() => expect(h.view()?.observation?.execute).toBeTruthy());
}

async function reconcileLive(h: ReturnType<typeof liveStoreHarness>) {
  const before = h.observed();
  h.dispatch(nativeReviewReconcileRequested(owner));
  await vi.waitFor(() => expect(h.observed()).toBe(before + 1));
}

describe('rejected reconciliation through the real store, facade and Electron transport', () => {
  it('retains known execute receipts after both an IPC error and a pre-dispatch rejection', async () => {
    const bridge = installNativeBridge();
    const h = liveStoreHarness();
    await startLive(h);
    await confirmLive(h);
    bridge.retire();
    bridge.rejectReconciles();
    await reconcileLive(h);
    expect(h.view()?.observation).toEqual(observation);

    const calls = bridge.api.invoke.mock.calls.length;
    Reflect.deleteProperty(window, 'electronAPI');
    await reconcileLive(h);
    expect(bridge.api.invoke.mock.calls).toHaveLength(calls);
    expect(h.view()?.observation).toEqual(observation);
    expect(h.retained()?.observation).toEqual(observation);
  });

  it('retains the separately reconciled receipt and prior uncertainty when the bridge guard rejects', async () => {
    const bridge = installNativeBridge('reconciliation');
    const h = liveStoreHarness();
    await startLive(h);
    await confirmLive(h);
    expect(h.view()?.observation?.uncertain).toBe(true);
    // A rejected check must also preserve a still-pending original observation.
    Reflect.deleteProperty(window, 'electronAPI');
    const pending = h.view()?.observation;
    const calls = bridge.api.invoke.mock.calls.length;
    await reconcileLive(h);
    expect(bridge.api.invoke.mock.calls).toHaveLength(calls);
    expect.soft(h.view()?.observation).toEqual({ ...pending, current: false });
    expect.soft(h.retained()?.observation).toEqual({ ...pending, current: false });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: bridge.api,
    });
    await reconcileLive(h);
    expect(h.view()?.observation).toEqual(bridge.reconciled);
    bridge.retire();
    Reflect.deleteProperty(window, 'electronAPI');
    const settledCalls = bridge.api.invoke.mock.calls.length;
    await reconcileLive(h);
    expect(bridge.api.invoke.mock.calls).toHaveLength(settledCalls);
    expect(h.view()?.observation).toEqual(bridge.reconciled);
    expect(h.retained()?.observation).toEqual(bridge.reconciled);
  });

  it('keeps a late old rejection private after closure and replacement without new writes', async () => {
    const bridge = installNativeBridge();
    const h = liveStoreHarness();
    await startLive(h);
    await confirmLive(h);
    Reflect.deleteProperty(window, 'electronAPI');
    h.dispatch(nativeReviewReconcileRequested(owner));
    h.dispatch(nativeReviewEditEnded(owner));
    const replacementBridge = installNativeBridge();
    const replacement = { ...owner, attemptId: 'replacement' };
    await startLive(h, replacement);
    expect(h.view()).toBeNull();
    expect(h.retained()?.observation).toEqual(observation);
    expect(h.view(replacement)?.observation).toBeNull();
    expect(
      bridge.api.invoke.mock.calls.filter(([channel]) => channel === nativeChannels.EXECUTE),
    ).toHaveLength(1);
    expect(
      replacementBridge.api.invoke.mock.calls.filter(
        ([channel]) => channel === nativeChannels.EXECUTE || channel === nativeChannels.RECONCILE,
      ),
    ).toHaveLength(0);
  });

  it('keeps an initial rejected check uncertain without inventing a receipt or dispatch', async () => {
    const bridge = installNativeBridge();
    const h = liveStoreHarness();
    await startLive(h);
    const calls = bridge.api.invoke.mock.calls.length;
    Reflect.deleteProperty(window, 'electronAPI');
    await reconcileLive(h);
    expect(bridge.api.invoke.mock.calls).toHaveLength(calls);
    expect(h.view()?.observation).toEqual({
      current: false,
      uncertain: true,
      execute: null,
      reconciliation: null,
    });
  });
});

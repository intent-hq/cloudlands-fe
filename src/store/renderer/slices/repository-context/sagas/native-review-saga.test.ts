import { NativeReviewPreparationSchema } from '$shared/types/native-review';
import {
  NativeReviewInputSchema,
  NativeReviewObservationSchema,
  NativeReviewPreparedViewSchema,
} from '$shared/types/native-review-operation';
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
  NativeReviewObservation,
} from '$shared/types/native-review-operation';
import type { StoreState } from '../../../types';
import { repositoryContextSaga } from './repository-context-saga';
import { selectNativeReviewForOwner } from '../repository-context-selectors';
import {
  repositoryContextReducer,
  nativeReviewEditRequested,
  nativeReviewCompanionRequested,
  nativeReviewConfirmRequested,
  nativeReviewEditEnded,
  nativeReviewEditStarted,
  nativeReviewCommandStarted,
  repositoryContextRetired,
  nativeReviewReconcileRequested,
  nativeReviewObserved,
  nativeReviewEditCleared,
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
const originalWorkDisposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of originalWorkDisposers.splice(0).reverse()) await dispose();
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
    dispatch,
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

function lateTerminalHarness() {
  const live = new LiveWorkspacesClient();
  vi.mocked(appClient.workspaces.beginNativeReview).mockImplementation(
    live.beginNativeReview.bind(live),
  );
  const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
  const listeners = new Map<string, Map<string, (value: unknown) => void>>();
  type Prepared = ReturnType<typeof NativeReviewPreparedViewSchema.parse>;
  type OriginalResponse = { ok: true; result: NativeReviewObservation };
  type Pending = {
    id: string;
    promise: Promise<OriginalResponse>;
    settled: boolean;
    resolve: (value: OriginalResponse) => void;
    reject: (reason: Error) => void;
  };
  const sessions = new Map<
    string,
    { preview: Prepared; marked: boolean; companionOf?: string; original?: NativeReviewObservation }
  >();
  const pending: Pending[] = [];
  const releases: Promise<unknown>[] = [];
  const cleared: string[] = [];
  let listenerId = 0;
  const api = {
    invoke: vi.fn(
      (channel: string, payload: { id?: string; input?: unknown; companionOf?: string }) => {
        if (channel === channels.PREPARE) {
          const id = `late-original-${sessions.size + 1}`;
          const prepared = NativeReviewPreparedViewSchema.parse({
            ...preview,
            reviewPreparation: {
              ...preview.reviewPreparation,
              operationId: id,
              scope: {
                daemonId: 'controlled-host',
                authorityScopeId: id,
                authorityGeneration: '1',
              },
              contextRevision: { epoch: id, sequence: '1' },
            },
          });
          if (payload.companionOf) {
            const parent = sessions.get(payload.companionOf);
            expect(parent?.marked).toBe(true);
            expect(parent?.original?.execute?.reviewExecution?.outcome.status).toBe(
              'not-attempted',
            );
            expect(payload).toEqual({ companionOf: payload.companionOf, root });
          }
          const parsed = payload.companionOf
            ? undefined
            : NativeReviewInputSchema.parse(payload.input);
          sessions.set(id, {
            preview: prepared,
            marked: !!parsed?.review.companion,
            companionOf: payload.companionOf,
          });
          return Promise.resolve({ ok: true, result: { id, preview: prepared } });
        }
        if (!payload.id || !sessions.has(payload.id)) throw new Error('Unknown original lifetime');
        if (channel === channels.EXECUTE) {
          let resolve!: Pending['resolve'];
          let reject!: Pending['reject'];
          const promise = new Promise<OriginalResponse>((yes, no) => {
            resolve = yes;
            reject = no;
          });
          const original = { id: payload.id, promise, resolve, reject, settled: false };
          void promise.then(
            () => {
              original.settled = true;
            },
            () => {
              original.settled = true;
            },
          );
          pending.push(original);
          return promise;
        }
        if (channel === channels.RELEASE) {
          const release = Promise.resolve({ ok: true, result: { released: true } });
          releases.push(release);
          return release;
        }
        throw new Error('Unexpected command');
      },
    ),
    on(channel: string, handler: (value: unknown) => void) {
      const id = String(++listenerId),
        handlers = listeners.get(channel) ?? new Map();
      handlers.set(id, handler);
      listeners.set(channel, handlers);
      return id;
    },
    offById(channel: string, id: string) {
      listeners.get(channel)?.delete(id);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: api });
  type HostAction = { type: string; payload?: { admission: string; hostContext: string } };
  let onAction: ((type: string) => void) | undefined;
  const store = new StreamingStore(
    {
      repositoryContext: repositoryContextReducer,
      admission: (value: unknown, action: HostAction) =>
        action.type === 'test/replace-native-host'
          ? (action.payload?.admission ?? owner.admission)
          : typeof value === 'string'
            ? value
            : owner.admission,
      hostContext: (value: unknown, action: HostAction) =>
        action.type === 'test/replace-native-host'
          ? (action.payload?.hostContext ?? owner.hostContext)
          : typeof value === 'string'
            ? value
            : owner.hostContext,
    },
    () => (next) => (action) => {
      const result = next(action);
      if (
        action &&
        typeof action === 'object' &&
        'type' in action &&
        action.type === nativeReviewEditCleared.type
      )
        cleared.push((action as ReturnType<typeof nativeReviewEditCleared>).payload[0].attemptId);
      if (
        action &&
        typeof action === 'object' &&
        'type' in action &&
        typeof action.type === 'string'
      )
        onAction?.(action.type);
      return result;
    },
  );
  store.init();
  const stop = store.runSaga(repositoryContextSaga);
  originalWorkDisposers.push(async () => {
    stop();
    for (const original of pending)
      if (!original.settled) original.reject(new Error('Test teardown'));
    await Promise.allSettled(pending.map((original) => original.promise));
    await settleOriginalCallbacks();
    await Promise.all(releases);
    expect(pending.every((original) => original.settled)).toBe(true);
    store.dispose();
    if (previous) Object.defineProperty(window, 'electronAPI', previous);
    else Reflect.deleteProperty(window, 'electronAPI');
  });
  return {
    dispatch: store.dispatch,
    api,
    pending,
    sessions,
    releases,
    view: (edit: NativeReviewOwner = owner) =>
      selectNativeReviewForOwner.select(store.state as unknown as StoreState, edit),
    retained: (edit: NativeReviewOwner = owner) =>
      store.state.repositoryContext.nativeReviewAttempts
        ? getItem(store.state.repositoryContext.nativeReviewAttempts, edit.attemptId)
        : undefined,
    cleared: (edit: NativeReviewOwner = owner) => cleared.includes(edit.attemptId),
    onAction(handler: (type: string) => void) {
      onAction = handler;
    },
    notice(id: string, kind: NativeReviewRetirement) {
      for (const handler of listeners.get(channels.RETIRED)?.values() ?? []) handler({ id, kind });
    },
    count(channel: string) {
      return api.invoke.mock.calls.filter(([name]) => name === channel).length;
    },
  };
}

async function settleOriginalCallbacks() {
  // Join the already-resolved transport/facade continuation chain; no additional dispatch or clock advance.
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}
async function readyOriginal(h: ReturnType<typeof lateTerminalHarness>, edit = owner) {
  h.dispatch(nativeReviewEditRequested(edit, markedInput));
  await vi.waitFor(() => expect(h.view(edit)?.status).toBe('ready'));
}
async function issueOriginal(h: ReturnType<typeof lateTerminalHarness>, edit = owner) {
  const count = h.pending.length;
  h.dispatch(
    nativeReviewConfirmRequested(
      edit,
      edit.attemptId === companionOwner.attemptId
        ? { prTitle: 'Original child' }
        : { commitMessage: 'Original staged parent' },
    ),
  );
  await vi.waitFor(() => expect(h.pending).toHaveLength(count + 1));
  const original = h.pending[count];
  expect(original.settled).toBe(false);
  return original;
}
async function fulfillOriginal(
  h: ReturnType<typeof lateTerminalHarness>,
  original: ReturnType<typeof lateTerminalHarness>['pending'][number],
  uncertain = false,
) {
  const session = h.sessions.get(original.id);
  if (!session) throw new Error('Missing original preparation');
  const result = NativeReviewObservationSchema.parse({
    current: true,
    uncertain,
    reconciliation: null,
    execute: {
      operationId: original.id,
      root,
      state: 'settled',
      success: !uncertain,
      steps: [],
      ...(uncertain
        ? { error: 'Original reply uncertain' }
        : { result: { commitHash: 'original-parent-commit' } }),
      reviewExecution: {
        ...execution,
        requestId: original.id,
        preparation: session.preview.reviewPreparation,
        gitReceipts: uncertain ? [] : [{ stage: 'commit', commitHash: 'original-parent-commit' }],
        outcome: uncertain
          ? { status: 'uncertain', stage: 'create-pr', message: 'Original reply uncertain' }
          : { status: 'not-attempted' },
      },
    },
  });
  session.original = result;
  original.resolve({ ok: true, result });
  await original.promise;
  await settleOriginalCallbacks();
  expect(original.settled).toBe(true);
  return { ...result, current: false };
}
function assertNoContinuation(h: ReturnType<typeof lateTerminalHarness>, edit = owner) {
  const before = h.api.invoke.mock.calls.length;
  h.dispatch(nativeReviewConfirmRequested(edit, { prTitle: 'No replay' }));
  h.dispatch(nativeReviewReconcileRequested(edit));
  h.dispatch(
    nativeReviewCompanionRequested(edit, { ...companionOwner, attemptId: 'forbidden-child' }),
  );
  expect(h.api.invoke).toHaveBeenCalledTimes(before);
}

describe('original terminal retention after actual worker cancellation', () => {
  it('retains the parent result after EditEnded has cleared and released the worker', async () => {
    const h = lateTerminalHarness();
    await readyOriginal(h);
    const original = await issueOriginal(h);
    h.dispatch(nativeReviewEditEnded(owner));
    await vi.waitFor(() => expect(h.cleared()).toBe(true));
    expect(h.retained()?.status).toBe('closed');
    expect(h.view()).toBeNull();
    expect(original.settled).toBe(false);
    expect(h.count(nativeChannels.RELEASE)).toBe(1);
    await Promise.all(h.releases);
    const expected = await fulfillOriginal(h, original);
    expect.soft(h.retained()?.observation).toEqual(expected);
    expect(h.view()).toBeNull();
    assertNoContinuation(h);
    expect(h.count(nativeChannels.EXECUTE)).toBe(1);
    expect(h.count(nativeChannels.PREPARE)).toBe(1);
  });
  it('retains child uncertainty after workspaceUnmounted separately from the known parent receipt', async () => {
    const h = lateTerminalHarness();
    await readyOriginal(h);
    const parent = await issueOriginal(h);
    const parentResult = await fulfillOriginal(h, parent);
    h.notice(parent.id, 'admission');
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.view(companionOwner)?.status).toBe('ready'));
    const original = await issueOriginal(h, companionOwner);
    expect(h.sessions.get(original.id)?.companionOf).toBe(parent.id);
    h.dispatch(workspaceUnmounted(WorkspaceId(root.workspaceId)));
    await vi.waitFor(() => expect(h.cleared(companionOwner)).toBe(true));
    expect(h.cleared()).toBe(true);
    expect(original.settled).toBe(false);
    await Promise.all(h.releases);
    const expected = await fulfillOriginal(h, original, true);
    expect.soft(h.retained(companionOwner)?.observation).toEqual(expected);
    expect(h.retained()?.observation).toEqual(parentResult);
    expect(h.view()).toBeNull();
    expect(h.view(companionOwner)).toBeNull();
    assertNoContinuation(h, companionOwner);
    assertNoContinuation(h);
    expect(h.count(nativeChannels.EXECUTE)).toBe(2);
    expect(h.count(nativeChannels.PREPARE)).toBe(2);
  });
  it('keeps late old facts private after admission and host replacement without adopting them into an equal-root owner', async () => {
    const h = lateTerminalHarness();
    await readyOriginal(h);
    const original = await issueOriginal(h);
    h.dispatch({
      type: 'test/replace-native-host',
      payload: { admission: 'B/member', hostContext: 'host-B' },
    });
    await vi.waitFor(() => expect(h.cleared()).toBe(true));
    const fresh = { ...owner, attemptId: 'fresh-B', admission: 'B/member', hostContext: 'host-B' };
    await readyOriginal(h, fresh);
    const before = h.retained(fresh);
    expect(original.settled).toBe(false);
    await Promise.all(h.releases);
    const expected = await fulfillOriginal(h, original);
    expect.soft(h.retained()?.observation).toEqual(expected);
    expect(h.view()).toBeNull();
    expect(h.retained(fresh)).toEqual(before);
    expect(h.view(fresh)?.status).toBe('ready');
    expect(h.view(fresh)?.observation).toBeNull();
    assertNoContinuation(h);
    expect(h.count(nativeChannels.EXECUTE)).toBe(1);
    expect(h.count(nativeChannels.PREPARE)).toBe(2);
  });
  it('cancels before dispatch without inventing any result or child', async () => {
    const h = lateTerminalHarness();
    await readyOriginal(h);
    h.onAction((type) => {
      if (type === nativeReviewCommandStarted.type) h.dispatch(nativeReviewEditEnded(owner));
    });
    h.dispatch(nativeReviewConfirmRequested(owner, { commitMessage: 'Never execute' }));
    await vi.waitFor(() => expect(h.cleared()).toBe(true));
    await settleOriginalCallbacks();
    expect(h.pending).toHaveLength(0);
    expect(h.retained()?.observation).toBeNull();
    expect(h.retained()?.status).toBe('closed');
    expect(h.view()).toBeNull();
    assertNoContinuation(h);
    expect(h.count(nativeChannels.EXECUTE)).toBe(0);
    expect(h.count(nativeChannels.PREPARE)).toBe(1);
  });
  it('retains the existing still-live worker control after a closed notice', async () => {
    const h = lateTerminalHarness();
    await readyOriginal(h);
    const original = await issueOriginal(h);
    h.notice(original.id, 'closed');
    await vi.waitFor(() => expect(h.retained()?.status).toBe('closed'));
    expect(h.cleared()).toBe(false);
    expect(h.count(nativeChannels.RELEASE)).toBe(0);
    const expected = await fulfillOriginal(h, original);
    expect(h.retained()?.observation).toEqual(expected);
    expect(h.view()).toBeNull();
    assertNoContinuation(h);
    expect(h.cleared()).toBe(false);
    expect(h.count(nativeChannels.EXECUTE)).toBe(1);
    expect(h.count(nativeChannels.PREPARE)).toBe(1);
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
    invoke: vi.fn(async (channel: string, _payload?: unknown) => {
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

const companionOwner = { ...owner, attemptId: 'child' };
const markedInput = {
  ...input,
  action: 'commit' as const,
  review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' as const } },
};
const committedObservation = NativeReviewObservationSchema.parse({
  ...observation,
  execute: {
    ...observation.execute,
    success: true,
    reviewExecution: { ...execution, outcome: { status: 'not-attempted' } },
  },
});
async function startMarked(h: ReturnType<typeof harness>) {
  vi.mocked(h.session.confirm).mockResolvedValue(committedObservation);
  h.dispatch(nativeReviewEditRequested(owner, markedInput));
  await vi.waitFor(() => expect(h.view()?.status).toBe('ready'));
  h.dispatch(nativeReviewConfirmRequested(owner, { commitMessage: 'Original staged commit' }));
  await vi.waitFor(() => expect(h.view()?.observation).toEqual(committedObservation));
  h.retire('admission');
}
function childSession(): NativeReviewSession {
  return {
    preview,
    onRetired: vi.fn(() => vi.fn()),
    confirm: vi.fn(async () => observation),
    reconcile: vi.fn(async () => observation),
    release: vi.fn(async () => {}),
  };
}
describe('two explicit native attempts in the original root worker', () => {
  it('claims one child command, confirms independently and retains both histories after child end', async () => {
    const h = harness(),
      child = childSession();
    h.session.prepareCompanion = vi.fn(async () => child);
    await startMarked(h);
    expect(h.session.prepareCompanion).not.toHaveBeenCalled();
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.view(companionOwner)?.status).toBe('ready'));
    expect(h.session.prepareCompanion).toHaveBeenCalledOnce();
    expect(appClient.workspaces.beginNativeReview).toHaveBeenCalledOnce();
    expect(child.confirm).not.toHaveBeenCalled();
    h.dispatch(nativeReviewConfirmRequested(companionOwner, { prTitle: 'Separate title' }));
    await vi.waitFor(() => expect(h.view(companionOwner)?.observation).toEqual(observation));
    expect(h.view()?.observation).toEqual(committedObservation);
    h.dispatch(nativeReviewEditEnded(companionOwner));
    await vi.waitFor(() => expect(child.release).toHaveBeenCalledOnce());
    expect(h.view(companionOwner)).toBeNull();
    expect(h.retained(companionOwner)?.observation).toEqual(observation);
    expect(h.view()?.observation).toEqual(committedObservation);
    h.dispatch(
      nativeReviewCompanionRequested(owner, { ...companionOwner, attemptId: 'second-child' }),
    );
    expect(h.session.prepareCompanion).toHaveBeenCalledOnce();
  });
  it('rejects new-root/admission/host and occupied child descriptors without another capture', async () => {
    const h = harness();
    h.session.prepareCompanion = vi.fn(async () => childSession());
    await startMarked(h);
    for (const changed of [
      owner,
      { ...companionOwner, admission: 'B' },
      { ...companionOwner, hostContext: 'B' },
      { ...companionOwner, root: { ...root, kind: 'registered' as const, gitRootId: 'other' } },
    ])
      h.dispatch(nativeReviewCompanionRequested(owner, changed));
    h.dispatch(nativeReviewEditStarted(companionOwner));
    h.dispatch(nativeReviewEditEnded(companionOwner));
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await Promise.resolve();
    expect(h.session.prepareCompanion).not.toHaveBeenCalled();
    expect(h.view()?.observation).toEqual(committedObservation);
  });
  it('disposes a late child after end and leaves the parent able to reconcile', async () => {
    const h = harness(),
      child = childSession();
    let complete!: (value: NativeReviewSession) => void;
    h.session.prepareCompanion = vi.fn(
      () =>
        new Promise<NativeReviewSession>((resolve) => {
          complete = resolve;
        }),
    );
    await startMarked(h);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.session.prepareCompanion).toHaveBeenCalledOnce());
    h.dispatch(nativeReviewEditEnded(companionOwner));
    complete(child);
    await vi.waitFor(() => expect(child.release).toHaveBeenCalledOnce());
    expect(h.view(companionOwner)).toBeNull();
    h.dispatch(nativeReviewReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
  });
  it('stops a reentrant child end before dispatch and never reopens that occupied attempt', async () => {
    const h = harness();
    h.session.prepareCompanion = vi.fn(async () => childSession());
    await startMarked(h);
    h.onReduce((action) => {
      if (action.type === nativeReviewEditStarted.type)
        h.dispatch(nativeReviewEditEnded(companionOwner));
    });
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await Promise.resolve();
    expect(h.session.prepareCompanion).not.toHaveBeenCalled();
    expect(h.view(companionOwner)).toBeNull();
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    expect(h.session.prepareCompanion).not.toHaveBeenCalled();
    await Promise.resolve();
    h.dispatch(nativeReviewReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
  });
  it('releases a child with a rejected retirement subscription while preserving the parent', async () => {
    const h = harness(),
      child = childSession();
    child.onRetired = vi.fn(() => {
      throw new Error('subscription unavailable');
    });
    h.session.prepareCompanion = vi.fn(async () => child);
    await startMarked(h);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.retained(companionOwner)?.status).toBe('unavailable'));
    expect(child.release).toHaveBeenCalledOnce();
    expect(h.view()?.observation).toEqual(committedObservation);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    expect(h.session.prepareCompanion).toHaveBeenCalledOnce();
    h.dispatch(nativeReviewReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
  });
  it('ends only the child on reentrant cancellation before child confirmation', async () => {
    const h = harness(),
      child = childSession();
    h.session.prepareCompanion = vi.fn(async () => child);
    await startMarked(h);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.view(companionOwner)?.status).toBe('ready'));
    h.onReduce((action) => {
      if (action.type === nativeReviewCommandStarted.type)
        h.dispatch(nativeReviewEditEnded(companionOwner));
    });
    h.dispatch(nativeReviewConfirmRequested(companionOwner, { prTitle: 'Cancelled' }));
    await vi.waitFor(() => expect(h.view(companionOwner)).toBeNull());
    expect(child.confirm).not.toHaveBeenCalled();
    expect(h.view()?.observation).toEqual(committedObservation);
    h.dispatch(nativeReviewReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
  });
  it('retains both observations when either reconcile rejects and isolates a fresh replacement', async () => {
    const h = harness(),
      child = childSession();
    h.session.prepareCompanion = vi.fn(async () => child);
    await startMarked(h);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await vi.waitFor(() => expect(h.view(companionOwner)?.status).toBe('ready'));
    h.dispatch(nativeReviewConfirmRequested(companionOwner, { prTitle: 'Create' }));
    await vi.waitFor(() => expect(h.view(companionOwner)?.observation).toEqual(observation));
    vi.mocked(h.session.reconcile).mockRejectedValue(new Error('parent check failed'));
    vi.mocked(child.reconcile).mockRejectedValue(new Error('child check failed'));
    h.dispatch(nativeReviewReconcileRequested(owner));
    h.dispatch(nativeReviewReconcileRequested(companionOwner));
    await vi.waitFor(() => expect(child.reconcile).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
    expect(h.retained()?.observation).toEqual(committedObservation);
    expect(h.retained(companionOwner)?.observation).toEqual(observation);
    const fresh = { ...owner, attemptId: 'replacement' };
    await start(h, fresh);
    expect(h.view()).toBeNull();
    expect(h.view(companionOwner)).toBeNull();
    expect(h.view(fresh)?.observation).toBeNull();
    expect(h.retained(companionOwner)?.observation).toEqual(observation);
  });
  it('keeps older sessions and known-only history unavailable without fresh preparation', async () => {
    const h = harness();
    await startMarked(h);
    h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
    await Promise.resolve();
    expect(h.view(companionOwner)).toBeNull();
    expect(appClient.workspaces.beginNativeReview).toHaveBeenCalledOnce();
  });
});

it('retains two genuine facade observations through rejected checks in the actual StreamingStore/root saga', async () => {
  const bridge = installNativeBridge(),
    h = liveStoreHarness();
  const wirePreview = (id: string) => ({
    ...preview,
    reviewPreparation: {
      ...preview.reviewPreparation,
      operationId: id,
      scope: { daemonId: 'host-A', authorityScopeId: id, authorityGeneration: '1' },
      contextRevision: { epoch: id, sequence: '1' },
    },
  });
  const parentWire = wirePreview('parent-operation'),
    childWire = wirePreview('child-operation');
  const parentObservation = NativeReviewObservationSchema.parse({
    ...committedObservation,
    execute: {
      ...committedObservation.execute,
      operationId: 'parent-operation',
      reviewExecution: {
        ...committedObservation.execute!.reviewExecution,
        requestId: 'parent-operation',
        preparation: parentWire.reviewPreparation,
      },
    },
  });
  const childObservation = NativeReviewObservationSchema.parse({
    ...observation,
    execute: {
      ...observation.execute,
      operationId: 'child-operation',
      success: true,
      reviewExecution: {
        ...execution,
        requestId: 'child-operation',
        preparation: childWire.reviewPreparation,
        gitReceipts: [],
        outcome: fixture.execute.reviewExecution.outcome,
      },
    },
  });
  bridge.api.invoke.mockImplementation(async (channel, payload) => {
    const value = payload as { id?: string; companionOf?: string };
    if (channel === nativeChannels.PREPARE)
      return {
        ok: true,
        result: value.companionOf
          ? { id: 'child-local', preview: childWire }
          : { id: 'original-local-id', preview: parentWire },
      };
    if (channel === nativeChannels.EXECUTE)
      return {
        ok: true,
        result: value.id === 'child-local' ? childObservation : parentObservation,
      };
    if (channel === nativeChannels.RELEASE) return { ok: true, result: { released: true } };
    throw new Error('Original observation unavailable');
  });
  h.dispatch(nativeReviewEditRequested(owner, markedInput));
  await vi.waitFor(() => expect(h.view()?.status).toBe('ready'));
  h.dispatch(nativeReviewConfirmRequested(owner, { commitMessage: 'Original' }));
  await vi.waitFor(() => expect(h.view()?.observation).toEqual(parentObservation));
  bridge.retire();
  h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
  h.dispatch(nativeReviewCompanionRequested(owner, companionOwner));
  await vi.waitFor(() => expect(h.view(companionOwner)?.status).toBe('ready'));
  expect(
    bridge.api.invoke.mock.calls.filter(([name]) => name === nativeChannels.PREPARE),
  ).toHaveLength(2);
  expect(bridge.api.invoke).toHaveBeenCalledWith(nativeChannels.PREPARE, {
    companionOf: 'original-local-id',
    root,
  });
  h.dispatch(nativeReviewConfirmRequested(companionOwner, { prTitle: 'Explicit create' }));
  await vi.waitFor(() => expect(h.view(companionOwner)?.observation).toEqual(childObservation));
  const count = bridge.api.invoke.mock.calls.length,
    before = h.observed();
  Reflect.deleteProperty(window, 'electronAPI');
  h.dispatch(nativeReviewReconcileRequested(owner));
  h.dispatch(nativeReviewReconcileRequested(companionOwner));
  await vi.waitFor(() => expect(h.observed()).toBe(before + 2));
  expect(bridge.api.invoke).toHaveBeenCalledTimes(count);
  expect(h.retained()?.observation).toEqual(parentObservation);
  expect(h.retained(companionOwner)?.observation).toEqual(childObservation);
  h.dispatch(nativeReviewEditEnded(owner));
  expect(h.view()).toBeNull();
  expect(h.view(companionOwner)).toBeNull();
  expect(h.retained()?.observation?.execute?.reviewExecution?.gitReceipts).toHaveLength(1);
  expect(
    h.retained(companionOwner)?.observation?.execute?.reviewExecution?.gitReceipts,
  ).toHaveLength(0);
});

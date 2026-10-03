import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type {
  RepositorySelectionEdit,
  RepositorySelectionSession,
  SelectionRetirement,
} from '$shared/types/repository-selection';
import type { StoreState } from '../../../types';
import { repositoryContextSaga } from './repository-context-saga';
import { selectRepositorySelectionForEdit } from '../repository-context-selectors';
import {
  repositoryContextReducer,
  repositorySelectionEditRequested,
  repositorySelectionConfirmRequested,
  repositorySelectionEditEnded,
  repositorySelectionEditStarted,
  repositorySelectionCommandStarted,
  repositoryContextRetired,
  repositorySelectionReconcileRequested,
} from '../repository-context-slice';
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: { beginRepositorySelectionEdit: vi.fn(), observeRepositoryContext: vi.fn() },
  },
}));
vi.mock('../../principal/principal-selectors', () => ({
  selectPrincipalActionContext: {
    select: (s: { admission: string | null }) => s.admission,
    effect: function* () {
      return yield* select((s: { admission: string | null }) => s.admission);
    },
  },
}));
const root = { workspaceId: 'equal-id', kind: 'primary' as const },
  owner = { root, editId: 'edit-1', admission: 'A/guest' };
const preview = {
  root,
  scope: { daemonId: 'A', authorityScopeId: 'op', authorityGeneration: '1' },
  snapshot: {
    root,
    rootIncarnation: '1',
    selectionRevision: '0',
    selection: { kind: 'neverSaved' as const },
  },
  expiresAfterMs: 300000 as const,
};
const observation = {
  current: false,
  uncertain: false,
  attempt: {
    status: 'settled' as const,
    receipt: {
      result: { kind: 'failed' as const, code: 'admission-retired' as const },
      persistence: { kind: 'committed' as const, selectionRevision: '2' },
    },
  },
};
const tasks: Task[] = [];
afterEach(() => {
  tasks.splice(0).forEach((t) => t.cancel());
  vi.clearAllMocks();
});
function harness() {
  let state = {
    admission: 'A/guest' as string | null,
    repositoryContext: repositoryContextReducer(undefined, { type: 'init' }),
  };
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  let onAction: ((action: { type: string }) => void) | undefined;
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = {
      ...state,
      repositoryContext: repositoryContextReducer(state.repositoryContext, action as never),
    };
    listeners.forEach((l) => l());
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
  let retirement: (kind: SelectionRetirement) => void = () => {};
  const session: RepositorySelectionSession = {
    preview,
    onRetired: vi.fn(() => vi.fn()),
    confirm: vi.fn(async () => observation),
    reconcile: vi.fn(async () => observation),
    release: vi.fn(async () => {}),
  };
  vi.mocked(appClient.workspaces.beginRepositorySelectionEdit).mockImplementation(
    async (_request, handler) => {
      retirement = handler;
      return session;
    },
  );
  return {
    dispatch,
    session,
    retire: (kind: SelectionRetirement) => retirement(kind),
    view: (edit: RepositorySelectionEdit = owner) =>
      selectRepositorySelectionForEdit.select(state as unknown as StoreState, edit),
    retained: (edit: RepositorySelectionEdit = owner) =>
      state.repositoryContext.selectionEdits
        ? getItem(state.repositoryContext.selectionEdits, edit.editId)
        : undefined,
    principal(value: string | null) {
      state = { ...state, admission: value };
      listeners.forEach((l) => l());
    },
    onAction(fn: typeof onAction) {
      onAction = fn;
    },
  };
}
async function start(h: ReturnType<typeof harness>, edit = owner) {
  h.dispatch(repositorySelectionEditRequested(edit));
  await vi.waitFor(() => expect(h.view(edit)?.status).toBe('ready'));
}
describe('typed edit ownership through actual Themis root saga', () => {
  it('captures before confirmation and retains failed plus committed across read retirement', async () => {
    const h = harness();
    await start(h);
    expect(h.session.confirm).not.toHaveBeenCalled();
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    await vi.waitFor(() => expect(h.view()?.observation).toEqual(observation));
    h.dispatch(repositoryContextRetired(root.workspaceId, 'read-only'));
    expect(h.view()?.observation?.attempt).toEqual(observation.attempt);
    h.dispatch(repositorySelectionEditEnded(owner));
    await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
    expect(h.view()).toBeNull();
  });
  it('keeps pending receipt ownership through ordinary retirement without another command', async () => {
    const h = harness();
    let settle!: (value: typeof observation) => void;
    vi.mocked(h.session.confirm).mockImplementation(
      () =>
        new Promise((r) => {
          settle = r;
        }),
    );
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    h.retire('admission');
    expect(h.view()?.status).toBe('retired');
    h.dispatch(
      repositorySelectionConfirmRequested(owner, { kind: 'save', choice: { mode: 'automatic' } }),
    );
    expect(h.session.confirm).toHaveBeenCalledOnce();
    settle(observation);
    await vi.waitFor(() => expect(h.view()?.observation).toEqual(observation));
    h.dispatch(repositorySelectionReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
  });
  it.each(['committed', 'unknown'] as const)(
    'hides a closed edit while retaining its original failed plus %s receipt',
    async (persistence) => {
      const h = harness();
      const original = {
        ...observation,
        attempt: {
          ...observation.attempt,
          receipt: {
            ...observation.attempt.receipt,
            persistence:
              persistence === 'committed'
                ? observation.attempt.receipt.persistence
                : { kind: 'unknown' as const },
          },
        },
      };
      vi.mocked(h.session.confirm).mockResolvedValueOnce(original);
      await start(h);
      h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
      await vi.waitFor(() => expect(h.view()?.observation).toEqual(original));
      h.retire('closed');
      expect(h.view()).toBeNull();
      expect(h.retained()?.observation).toEqual(original);
      h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
      h.dispatch(repositorySelectionReconcileRequested(owner));
      expect(h.session.confirm).toHaveBeenCalledOnce();
      expect(h.session.reconcile).not.toHaveBeenCalled();
    },
  );
  it('retains a late original result without reopening a closed view', async () => {
    const h = harness();
    let settle!: (value: typeof observation) => void;
    vi.mocked(h.session.confirm).mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    h.retire('closed');
    expect(h.view()).toBeNull();
    settle(observation);
    await vi.waitFor(() => expect(h.retained()?.observation).toEqual(observation));
    expect(h.view()).toBeNull();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledOnce();
    expect(h.session.confirm).toHaveBeenCalledOnce();
  });
  it('does not recapture or clear a retained closed edit when its descriptor repeats', async () => {
    const h = harness();
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    await vi.waitFor(() => expect(h.view()?.observation).toEqual(observation));
    h.retire('closed');
    h.dispatch(repositorySelectionEditRequested(owner));
    h.dispatch(repositorySelectionEditRequested({ ...owner, root: { ...root } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledOnce();
    expect(h.session.release).not.toHaveBeenCalled();
    expect(h.retained()?.observation).toEqual(observation);
    expect(h.view()).toBeNull();
    h.dispatch(repositorySelectionEditEnded(owner));
    expect(h.session.release).toHaveBeenCalledOnce();
    expect(h.retained()).toBeUndefined();
  });
  it('does not transfer a closed pending result into a fresh same-root edit', async () => {
    const h = harness();
    let settle!: (value: typeof observation) => void;
    vi.mocked(h.session.confirm).mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    h.retire('closed');
    const next = { ...owner, editId: 'fresh-edit' };
    const nextSession = {
      ...h.session,
      confirm: vi.fn(async () => observation),
      reconcile: vi.fn(async () => observation),
      release: vi.fn(async () => {}),
    };
    vi.mocked(appClient.workspaces.beginRepositorySelectionEdit).mockResolvedValueOnce(nextSession);
    await start(h, next);
    expect(h.session.release).toHaveBeenCalledOnce();
    settle(observation);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.retained()).toBeUndefined();
    expect(h.view()).toBeNull();
    expect(h.view(next)?.observation).toBeNull();
    expect(h.view(next)?.status).toBe('ready');
    h.dispatch(repositorySelectionEditEnded(owner));
    expect(h.view(next)?.status).toBe('ready');
    expect(nextSession.release).not.toHaveBeenCalled();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledTimes(2);
  });
  it('keeps ordinary retirement visible and permits original receipt reconciliation', async () => {
    const h = harness();
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    await vi.waitFor(() => expect(h.view()?.observation).toEqual(observation));
    h.retire('admission');
    expect(h.view()?.status).toBe('retired');
    expect(h.view()?.observation).toEqual(observation);
    h.dispatch(repositorySelectionReconcileRequested(owner));
    await vi.waitFor(() => expect(h.session.reconcile).toHaveBeenCalledOnce());
    expect(h.view()?.observation).toEqual(observation);
    expect(h.session.confirm).toHaveBeenCalledOnce();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledOnce();
  });
  it('clears old admission, never reacquires, and ignores an old equal-workspace end', async () => {
    const h = harness();
    await start(h);
    h.principal('B/guest');
    await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
    expect(h.view()).toBeNull();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledOnce();
    const next = { ...owner, editId: 'new', admission: 'B/guest' };
    await start(h, next);
    h.dispatch(repositorySelectionEditEnded(owner));
    expect(h.view(next)?.status).toBe('ready');
  });
  it('disposes a late capture after unmount ownership ends without adopting its result', async () => {
    const h = harness();
    let resolve!: (s: RepositorySelectionSession) => void;
    vi.mocked(appClient.workspaces.beginRepositorySelectionEdit).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    h.dispatch(repositorySelectionEditRequested(owner));
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    h.dispatch(repositorySelectionEditEnded(owner));
    resolve(h.session);
    await vi.waitFor(() => expect(h.session.release).toHaveBeenCalledOnce());
    expect(h.view()).toBeNull();
  });
  it('does not start capture when a synchronous subscriber ends the original demand', async () => {
    const h = harness();
    h.onAction((action) => {
      if (action.type === repositorySelectionEditStarted.type)
        h.dispatch(repositorySelectionEditEnded(owner));
    });
    h.dispatch(repositorySelectionEditRequested(owner));
    await Promise.resolve();
    expect(appClient.workspaces.beginRepositorySelectionEdit).not.toHaveBeenCalled();
    expect(h.view()).toBeNull();
  });
  it('does not dispatch confirmation after a synchronous command-start admission replacement', async () => {
    const h = harness();
    await start(h);
    h.onAction((action) => {
      if (action.type === repositorySelectionCommandStarted.type) h.principal('B/guest');
    });
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    expect(h.session.confirm).not.toHaveBeenCalled();
    expect(h.view()).toBeNull();
  });
  it('preserves unavailable and uncertain outcomes without retrying the edit', async () => {
    const h = harness();
    vi.mocked(h.session.confirm).mockRejectedValueOnce(new Error('transport gone'));
    await start(h);
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    await vi.waitFor(() =>
      expect(h.view()?.observation).toEqual({ current: false, attempt: null, uncertain: true }),
    );
    h.dispatch(repositorySelectionConfirmRequested(owner, { kind: 'reset' }));
    expect(h.session.confirm).toHaveBeenCalledOnce();
    expect(appClient.workspaces.beginRepositorySelectionEdit).toHaveBeenCalledOnce();
  });
});

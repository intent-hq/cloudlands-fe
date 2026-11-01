import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Saga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  notifyError: vi.fn(),
  storage: new Map<string, unknown>(),
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.notifyError, info: vi.fn() },
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    return mocks.storage.get(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.storage.set(key, value);
  },
}));

import type { StoreState } from '../../../types';
import { store } from '../../../store';
import {
  labelWorkspace,
  reduceWorkspaceLabelsState,
  workspaceLabelsState,
} from '../../../../../test/fixtures/workspace-labels-state';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  bulkUpdateWorkspaceEntities,
  setWorkspaceHasLoaded,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectPinnedWorkspaceIds, selectWorkspaceLabelsInUse } from '../sidebar-nav-selectors';
import {
  PINNED_WORKSPACES_KEY,
  PINNED_WORKSPACES_LABEL_MIGRATION_KEY,
  setWorkspaceLabel,
  togglePinWorkspace,
} from '../sidebar-nav-slice';
import { PINNED_WORKSPACE_LABEL } from '../workspace-labels';
import { sidebarNavSaga } from './sidebar-nav-saga';
import { resetWorkspaceLabelWritesForTest } from './workspace-label-saga';

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function served(id: string, label: string | null) {
  return { ok: true, data: labelWorkspace(id, label ? { label } : {}) };
}

function start(initial: StoreState, saga: Saga = sidebarNavSaga) {
  const dispose = store.init(initial);
  let state = initial;
  const channel = stdChannel();
  const dispatched: Array<{ type: string }> = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string }) => {
        dispatched.push(action);
        state = reduceWorkspaceLabelsState(state, action);
        channel.put(action);
      },
      getState: () => state,
    },
    saga,
  );
  return {
    task,
    dispatched,
    get state() {
      return state;
    },
    set state(next: StoreState) {
      state = next;
    },
    put(action: { type: string }) {
      state = reduceWorkspaceLabelsState(state, action);
      channel.put(action);
    },
    label(id: string) {
      return selectWorkspaceById.select(state, id)?.label;
    },
    async stop() {
      task.cancel();
      await task.toPromise();
      dispose();
    },
  };
}

function readmitted(state: StoreState, label: string | undefined): StoreState {
  const next = workspaceLabelsState({ workspaces: [labelWorkspace('ws-1', { label })] });
  next.principal = { ...next.principal, invalidation: state.principal.invalidation + 1 };
  next.workspace = {
    ...next.workspace,
    capabilityContext: selectPrincipalActionContext.select(next),
  };
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.clear();
  // Migration already done unless a test opts in, so it stays out of the way.
  mocks.storage.set(PINNED_WORKSPACES_LABEL_MIGRATION_KEY, true);
  resetWorkspaceLabelWritesForTest();
});

describe('setWorkspaceLabel', () => {
  it('sets, replaces and clears a label through workspace.update', async () => {
    const run = start(workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')] }));
    await settle();

    mocks.update.mockResolvedValueOnce(served('ws-1', 'For Later'));
    run.put(setWorkspaceLabel('ws-1', '  For Later '));
    expect(run.label('ws-1')).toBe('For Later');
    await settle();

    mocks.update.mockResolvedValueOnce(served('ws-1', 'Review'));
    run.put(setWorkspaceLabel('ws-1', 'Review'));
    await settle();
    expect(run.label('ws-1')).toBe('Review');

    mocks.update.mockResolvedValueOnce(served('ws-1', null));
    run.put(setWorkspaceLabel('ws-1', null));
    await settle();
    expect(run.label('ws-1')).toBeUndefined();

    expect(mocks.update.mock.calls).toEqual([
      [{ id: 'ws-1', label: 'For Later' }],
      [{ id: 'ws-1', label: 'Review' }],
      [{ id: 'ws-1', label: null }],
    ]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await run.stop();
  });

  it('applies right away and rolls back with a toast when the call fails', async () => {
    const run = start(
      workspaceLabelsState({ workspaces: [labelWorkspace('ws-1', { label: 'Old' })] }),
    );
    await settle();
    const reply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(reply.promise);

    run.put(setWorkspaceLabel('ws-1', 'New'));
    await settle();
    expect(run.label('ws-1')).toBe('New');

    reply.resolve({ ok: false, error: 'forbidden' });
    await settle();
    expect(run.label('ws-1')).toBe('Old');
    expect(mocks.notifyError).toHaveBeenCalledWith('forbidden');

    // The old reply cannot roll back a fresh projection with the same label.
    const retired = deferred<unknown>();
    mocks.update.mockReturnValueOnce(retired.promise);
    run.put(setWorkspaceLabel('ws-1', 'pinned'));
    await settle();
    run.state = readmitted(run.state, 'pinned');
    retired.resolve({ ok: false, error: 'access changed' });
    await settle();
    expect(run.label('ws-1')).toBe('pinned');
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);

    // A retired success cannot rebase the replacement owner's rollback.
    const oldReply = deferred<unknown>();
    const currentReply = deferred<unknown>();
    mocks.update.mockReturnValueOnce(oldReply.promise).mockReturnValueOnce(currentReply.promise);
    run.put(setWorkspaceLabel('ws-1', 'Old intent'));
    await settle();
    run.state = readmitted(run.state, 'Fresh projection');
    run.put(setWorkspaceLabel('ws-1', 'Current intent'));
    await settle();
    oldReply.resolve(served('ws-1', 'Old intent'));
    await settle();
    expect(run.label('ws-1')).toBe('Current intent');
    currentReply.resolve({ ok: false, error: 'current refusal' });
    await settle();
    expect(run.label('ws-1')).toBe('Fresh projection');
    expect(mocks.notifyError).toHaveBeenCalledTimes(2);
    await run.stop();
  });

  it('rolls back a thrown call to the original value', async () => {
    const run = start(workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')] }));
    await settle();
    mocks.update.mockRejectedValueOnce(new Error('offline'));

    run.put(setWorkspaceLabel('ws-1', 'New'));
    await settle();

    expect(run.label('ws-1')).toBeUndefined();
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
    await run.stop();
  });

  it('rolls a failed later write back to an earlier accepted one', async () => {
    const run = start(workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')] }));
    await settle();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceLabel('ws-1', 'A'));
    run.put(setWorkspaceLabel('ws-1', 'B'));
    await settle();
    expect(run.label('ws-1')).toBe('B');

    first.resolve(served('ws-1', 'A'));
    await settle();
    expect(run.label('ws-1')).toBe('B');

    second.resolve({ ok: false, error: 'nope' });
    await settle();
    expect(run.label('ws-1')).toBe('A');
    await run.stop();
  });

  it('rolls back to a remote label that arrived between two failed local writes', async () => {
    const run = start(
      workspaceLabelsState({ workspaces: [labelWorkspace('ws-1', { label: 'Old' })] }),
    );
    await settle();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    run.put(setWorkspaceLabel('ws-1', 'A'));
    await settle();
    // Another client's authoritative workspace:updated delta lands.
    run.put(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { label: 'Remote B' })]));
    run.put(setWorkspaceLabel('ws-1', 'C'));
    await settle();

    first.resolve({ ok: false, error: 'nope' });
    await settle();
    expect(run.label('ws-1')).toBe('C');

    second.resolve({ ok: false, error: 'nope' });
    await settle();
    expect(run.label('ws-1')).toBe('Remote B');
    await run.stop();
  });

  it.each([
    ['pinned', PINNED_WORKSPACE_LABEL, PINNED_WORKSPACE_LABEL],
    ['cleared', null, undefined],
  ] as const)(
    'keeps a remote label equal to a failed pending write (%s)',
    async (_name, requested, expected) => {
      const run = start(
        workspaceLabelsState({ workspaces: [labelWorkspace('ws-1', { label: 'Old' })] }),
      );
      await settle();
      const pending = deferred<unknown>();
      mocks.update.mockReturnValueOnce(pending.promise);

      run.put(setWorkspaceLabel('ws-1', requested));
      await settle();
      // Another client's accepted write lands with the same value.
      run.put(
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity('ws-1', { label: requested ?? undefined }),
        ]),
      );
      pending.resolve({ ok: false, error: 'nope' });
      await settle();
      expect(run.label('ws-1')).toBe(expected);
      await run.stop();
    },
  );

  it('removes a custom label from the list once its last workspace leaves it', async () => {
    const run = start(
      workspaceLabelsState({
        workspaces: [labelWorkspace('ws-1', { label: 'Later' }), labelWorkspace('ws-2')],
      }),
    );
    await settle();
    expect(selectWorkspaceLabelsInUse.select(run.state)).toEqual(['Later']);

    mocks.update.mockResolvedValueOnce(served('ws-1', 'Other'));
    run.put(setWorkspaceLabel('ws-1', 'Other'));
    await settle();
    expect(selectWorkspaceLabelsInUse.select(run.state)).toEqual(['Other']);
    await run.stop();
  });
});

describe('togglePinWorkspace', () => {
  it('sets and clears the "pinned" label when the daemon supports labels', async () => {
    const run = start(
      workspaceLabelsState({ workspaces: [labelWorkspace('ws-1', { label: 'Later' })] }),
    );
    await settle();

    mocks.update.mockResolvedValueOnce(served('ws-1', PINNED_WORKSPACE_LABEL));
    run.put(togglePinWorkspace('ws-1'));
    await settle();
    expect(run.label('ws-1')).toBe(PINNED_WORKSPACE_LABEL);
    expect(selectPinnedWorkspaceIds.select(run.state)).toEqual(['ws-1']);
    // Pinning a labelled workspace replaced its label.
    expect(selectWorkspaceLabelsInUse.select(run.state)).toEqual([]);
    expect(run.state.sidebarNav.pinnedWorkspaceIds).toEqual(['ws-1']);

    mocks.update.mockResolvedValueOnce(served('ws-1', null));
    run.put(togglePinWorkspace('ws-1'));
    await settle();
    expect(run.label('ws-1')).toBeUndefined();
    expect(selectPinnedWorkspaceIds.select(run.state)).toEqual([]);
    expect(run.state.sidebarNav.pinnedWorkspaceIds).toEqual([]);

    expect(mocks.update.mock.calls).toEqual([
      [{ id: 'ws-1', label: PINNED_WORKSPACE_LABEL }],
      [{ id: 'ws-1', label: null }],
    ]);
    // The local key keeps mirroring the pins for a client rollback.
    expect(mocks.storage.get(PINNED_WORKSPACES_KEY)).toEqual([]);
    await run.stop();
  });

  it('keeps local-only pins on a daemon without label support', async () => {
    const run = start(
      workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')], supported: false }),
    );
    await settle();

    run.put(togglePinWorkspace('ws-1'));
    await settle();

    expect(mocks.update).not.toHaveBeenCalled();
    expect(selectPinnedWorkspaceIds.select(run.state)).toEqual(['ws-1']);
    expect(mocks.storage.get(PINNED_WORKSPACES_KEY)).toEqual(['ws-1']);
    await run.stop();
  });
});

describe('pin label migration', () => {
  beforeEach(() => mocks.storage.delete(PINNED_WORKSPACES_LABEL_MIGRATION_KEY));

  it('labels unlabelled local pins once, skipping labelled and unknown workspaces', async () => {
    mocks.storage.set(PINNED_WORKSPACES_KEY, ['ws-1', 'ws-2', 'ws-gone']);
    mocks.update.mockResolvedValue(served('ws-1', PINNED_WORKSPACE_LABEL));
    const state = workspaceLabelsState({
      workspaces: [labelWorkspace('ws-1'), labelWorkspace('ws-2', { label: 'Later' })],
      pinned: ['ws-1', 'ws-2', 'ws-gone'],
    });
    const run = start(state);
    await settle();

    expect(mocks.update.mock.calls).toEqual([[{ id: 'ws-1', label: PINNED_WORKSPACE_LABEL }]]);
    expect(run.label('ws-1')).toBe(PINNED_WORKSPACE_LABEL);
    expect(run.label('ws-2')).toBe('Later');
    expect(mocks.storage.get(PINNED_WORKSPACES_LABEL_MIGRATION_KEY)).toBe(true);
    // The old pin key is left in place for a rollback.
    expect(mocks.storage.get(PINNED_WORKSPACES_KEY)).toEqual(['ws-1', 'ws-2', 'ws-gone']);

    // A later list load does not run it again.
    run.put(setWorkspaceHasLoaded(true, run.state.connections.windowBackendId));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await run.stop();

    // Nor does a fresh start with the done flag stored.
    const again = start(state);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await again.stop();
  });

  it('waits for the workspace list before migrating', async () => {
    mocks.storage.set(PINNED_WORKSPACES_KEY, ['ws-1']);
    mocks.update.mockResolvedValue(served('ws-1', PINNED_WORKSPACE_LABEL));
    const loaded = workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')] });
    const run = start({ ...loaded, workspace: { ...loaded.workspace, hasLoaded: false } });
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();

    run.put(setWorkspaceHasLoaded(true, loaded.connections.windowBackendId));
    run.state = { ...run.state, workspace: { ...run.state.workspace, ...loaded.workspace } };
    run.put(setWorkspaceHasLoaded(true, loaded.connections.windowBackendId));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await run.stop();

    // The next admission is ready while the old migration's real write is held.
    // It must be evaluated after that write retires, without a second ready event.
    mocks.update.mockClear();
    mocks.storage.delete(PINNED_WORKSPACES_LABEL_MIGRATION_KEY);
    const oldWrite = deferred<unknown>();
    mocks.update
      .mockReturnValueOnce(oldWrite.promise)
      .mockResolvedValueOnce(served('ws-current', 'pinned'));
    const switching = start(loaded);
    await settle();
    expect(mocks.update.mock.calls).toEqual([[{ id: 'ws-1', label: 'pinned' }]]);
    switching.state = readmitted(switching.state, undefined);
    switching.put(setWorkspaceEntity(labelWorkspace('ws-current')));
    mocks.storage.set(PINNED_WORKSPACES_KEY, ['ws-current']);
    switching.put(setWorkspaceHasLoaded(true, switching.state.connections.windowBackendId));
    oldWrite.resolve(served('ws-1', 'pinned'));
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [{ id: 'ws-1', label: 'pinned' }],
      [{ id: 'ws-current', label: 'pinned' }],
    ]);
    expect(switching.label('ws-1')).toBeUndefined();
    expect(switching.label('ws-current')).toBe('pinned');
    expect(mocks.storage.get(PINNED_WORKSPACES_LABEL_MIGRATION_KEY)).toBe(true);
    await switching.stop();
  });

  it('does not mark the migration done when a write fails', async () => {
    mocks.storage.set(PINNED_WORKSPACES_KEY, ['ws-1']);
    mocks.update.mockResolvedValue({ ok: false, error: 'boom' });
    const run = start(
      workspaceLabelsState({ workspaces: [labelWorkspace('ws-1')], pinned: ['ws-1'] }),
    );
    await settle();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(run.label('ws-1')).toBeUndefined();
    expect(mocks.storage.has(PINNED_WORKSPACES_LABEL_MIGRATION_KEY)).toBe(false);
    // Silent: the user did not ask for this write.
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await run.stop();
  });

  it('never migrates on a daemon without label support', async () => {
    mocks.storage.set(PINNED_WORKSPACES_KEY, ['ws-1']);
    const run = start(
      workspaceLabelsState({
        workspaces: [labelWorkspace('ws-1')],
        pinned: ['ws-1'],
        supported: false,
      }),
    );
    await settle();

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.storage.has(PINNED_WORKSPACES_LABEL_MIGRATION_KEY)).toBe(false);
    expect(selectPinnedWorkspaceIds.select(run.state)).toEqual(['ws-1']);
    await run.stop();
  });
});

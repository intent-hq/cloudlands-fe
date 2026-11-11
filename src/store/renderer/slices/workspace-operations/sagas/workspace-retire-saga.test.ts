import { store } from '../../../store';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

const mocks = vi.hoisted(() => ({
  retire: vi.fn(),
  unarchive: vi.fn(),
  list: vi.fn(),
  navigate: vi.fn(),
  notify: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { retire: mocks.retire, unarchive: mocks.unarchive },
}));
vi.mock('$lib/client', () => ({ appClient: { workspaces: { list: mocks.list } } }));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  navigateAwayIfViewing: mocks.navigate,
}));
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: mocks.notify,
}));

import { m } from '$shared/paraglide/messages.js';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import {
  initialState as workspaceInitialState,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  closeBulkRetireConfirm,
  closeRetireConfirm,
  confirmBulkRetire,
  confirmRetireWorkspace,
  openBulkRetireConfirm,
  initialState as operationsInitialState,
  loadRetiredWorkspacesRequested,
  requestRetireWorkspace,
  requestUnarchiveWorkspace,
  workspaceOperationsReducer,
} from '../workspace-operations-slice';
import { workspaceOperationsSaga } from './workspace-operations-saga';

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const workspace = (id: string, overrides: Partial<Workspace> = {}): Workspace =>
  ({
    id,
    title: `Title ${id}`,
    status: WorkspaceStatusEnum.Active,
    archived: false,
    ...overrides,
  }) as Workspace;

const retiredRow = (id: string) =>
  workspace(id, {
    status: WorkspaceStatusEnum.Retired,
    archived: true,
    archivedAt: '2026-10-01T00:00:00Z',
    retiredAt: '2026-10-20T00:00:00Z',
  });

function harness(seed: Workspace[]) {
  const channel = stdChannel();
  let workspaceState = workspaceInitialState;
  for (const item of seed)
    workspaceState = workspaceReducer(workspaceState, setWorkspaceEntity(item));
  store.dispose();
  store.init(
    withLegacyPrincipal({ workspace: workspaceState, workspaceOperations: operationsInitialState }),
  );
  // Like the real middleware, every dispatched action (including the saga's
  // own puts) also reaches the saga channel, so action journals observe them.
  const dispatch = vi.fn((action) => {
    store.dispatch(action);
    channel.put(action);
  });
  const task = runSaga({ channel, dispatch, getState: () => store.state }, workspaceOperationsSaga);
  const send = (action: Parameters<typeof workspaceOperationsReducer>[1]) => dispatch(action);
  const row = (id: string) => getItem(store.state.workspace.workspaces, id as Workspace['id']);
  return { send, task, row, state: () => store.state };
}

describe('workspace retire confirm', () => {
  it('opens and closes the retire confirmation for one workspace', () => {
    const opened = workspaceOperationsReducer(
      operationsInitialState,
      requestRetireWorkspace('ws-1'),
    );
    expect(opened.showRetireConfirm).toBe(true);
    expect(opened.pendingRetireWorkspaceId).toBe('ws-1');

    const closed = workspaceOperationsReducer(opened, closeRetireConfirm());
    expect(closed.showRetireConfirm).toBe(false);
    expect(closed.pendingRetireWorkspaceId).toBeNull();
  });
});

describe('workspace retire saga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
  });
  afterEach(() => store.dispose());

  it('requesting retire only opens the confirmation; nothing is retired yet', async () => {
    const run = harness([workspace('ws-1')]);
    run.send(requestRetireWorkspace('ws-1'));
    await settle();
    expect(run.state().workspaceOperations.showRetireConfirm).toBe(true);
    expect(mocks.retire).not.toHaveBeenCalled();
    run.task.cancel();
  });

  it('confirming calls workspace.retire and folds the retired row into the store', async () => {
    mocks.retire.mockResolvedValue({ ok: true, data: retiredRow('ws-1') });
    const run = harness([workspace('ws-1')]);
    run.send(requestRetireWorkspace('ws-1'));
    run.send(confirmRetireWorkspace());
    await settle();

    expect(mocks.retire).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(run.state().workspaceOperations.showRetireConfirm).toBe(false);
    expect(run.row('ws-1')).toMatchObject({
      status: WorkspaceStatusEnum.Retired,
      archived: true,
      retiredAt: '2026-10-20T00:00:00Z',
    });
    expect(mocks.notify.success).toHaveBeenCalledWith(
      m.workspace_ops_purged_toast({ title: 'Title ws-1' }),
    );
    run.task.cancel();
  });

  it('explains retire-unsupported and leaves the workspace untouched', async () => {
    mocks.retire.mockResolvedValue({
      ok: false,
      error: 'nope',
      errorCode: 'retire-unsupported',
    });
    const run = harness([workspace('ws-1')]);
    run.send(requestRetireWorkspace('ws-1'));
    run.send(confirmRetireWorkspace());
    await settle();

    expect(mocks.notify.error).toHaveBeenCalledWith(m.workspace_ops_purgeUnsupported_error());
    expect(run.row('ws-1')?.status).toBe(WorkspaceStatusEnum.Active);
    run.task.cancel();
  });

  it('reports a generic failure for any other retire error', async () => {
    mocks.retire.mockResolvedValue({ ok: false, error: 'boom' });
    const run = harness([workspace('ws-1')]);
    run.send(requestRetireWorkspace('ws-1'));
    run.send(confirmRetireWorkspace());
    await settle();
    expect(mocks.notify.error).toHaveBeenCalledWith(m.workspace_ops_purgeFailed_error());
    run.task.cancel();
  });

  it('restoring a retired workspace calls unarchive and clears retiredAt', async () => {
    mocks.unarchive.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([retiredRow('ws-1')]);
    run.send(requestUnarchiveWorkspace('ws-1'));
    await settle();

    expect(mocks.unarchive).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(run.row('ws-1')).toMatchObject({ status: WorkspaceStatusEnum.Active, archived: false });
    expect(run.row('ws-1')?.retiredAt).toBeUndefined();
    run.task.cancel();
  });

  it('loads retired workspaces only through the explicit includeRetired opt-in', async () => {
    mocks.list.mockResolvedValue([workspace('ws-active'), retiredRow('ws-retired')]);
    const run = harness([]);
    run.send(loadRetiredWorkspacesRequested());
    await settle();

    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      includeArchived: true,
      includeRetired: true,
    });
    expect(run.row('ws-retired')?.status).toBe(WorkspaceStatusEnum.Retired);
    // Only the retired rows are folded in; the live list owns everything else.
    expect(run.row('ws-active')).toBeUndefined();
    run.task.cancel();
  });

  it('drops a retired list response that lands after the connection changed', async () => {
    let finish!: (rows: Workspace[]) => void;
    mocks.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const run = harness([]);
    run.send(loadRetiredWorkspacesRequested());
    await settle();
    run.send(connectionStatusChanged('disconnected'));
    finish([retiredRow('ws-stale')]);
    await settle();

    expect(run.row('ws-stale')).toBeUndefined();
    run.task.cancel();
  });

  function deferredList() {
    let finish!: (rows: Workspace[]) => void;
    mocks.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    return (rows: Workspace[]) => finish(rows);
  }

  it('keeps a restore that lands while the retired read is in flight', async () => {
    const finish = deferredList();
    mocks.unarchive.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([retiredRow('ws-r')]);
    run.send(loadRetiredWorkspacesRequested());
    await settle();
    run.send(requestUnarchiveWorkspace('ws-r'));
    await settle();
    expect(run.row('ws-r')?.status).toBe(WorkspaceStatusEnum.Active);

    finish([retiredRow('ws-r')]);
    await settle();
    expect(run.row('ws-r')?.status).toBe(WorkspaceStatusEnum.Active);
    run.task.cancel();
  });

  it('does not resurrect a workspace deleted while the retired read is in flight', async () => {
    const finish = deferredList();
    const run = harness([retiredRow('ws-r')]);
    run.send(loadRetiredWorkspacesRequested());
    await settle();
    run.send(removeWorkspaceEntity('ws-r'));
    await settle();

    finish([retiredRow('ws-r'), retiredRow('ws-other')]);
    await settle();
    expect(run.row('ws-r')).toBeUndefined();
    expect(run.row('ws-other')?.status).toBe(WorkspaceStatusEnum.Retired);
    run.task.cancel();
  });

  it('reports a failed retired list read', async () => {
    mocks.list.mockRejectedValue(new Error('offline'));
    const run = harness([]);
    run.send(loadRetiredWorkspacesRequested());
    await settle();
    expect(mocks.notify.error).toHaveBeenCalledWith(m.home_archived_loadFailed_error());
    run.task.cancel();
  });
});

describe('bulk retire saga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => store.dispose());

  const archivedRow = (id: string) =>
    workspace(id, { status: WorkspaceStatusEnum.Archived, archived: true });

  it('opening only shows the confirmation; cancelling clears it without retiring', async () => {
    const run = harness([archivedRow('ws-1'), archivedRow('ws-2')]);
    run.send(openBulkRetireConfirm({ workspaceIds: ['ws-1', 'ws-2'] }));
    await settle();
    expect(run.state().workspaceOperations).toMatchObject({
      showBulkRetireConfirm: true,
      pendingBulkWorkspaceIds: ['ws-1', 'ws-2'],
    });
    run.send(closeBulkRetireConfirm());
    await settle();
    expect(run.state().workspaceOperations).toMatchObject({
      showBulkRetireConfirm: false,
      pendingBulkWorkspaceIds: [],
    });
    expect(mocks.retire).not.toHaveBeenCalled();
    run.task.cancel();
  });

  it('retires only archived rows that still have a folder, once each', async () => {
    mocks.retire.mockImplementation(async (id: string) => ({ ok: true, data: retiredRow(id) }));
    const run = harness([
      archivedRow('ws-1'),
      workspace('ws-active'),
      retiredRow('ws-purged'),
      archivedRow('ws-2'),
    ]);
    run.send(
      openBulkRetireConfirm({
        workspaceIds: ['ws-1', 'ws-active', 'ws-purged', 'ws-missing', 'ws-2'],
      }),
    );
    run.send(confirmBulkRetire());
    run.send(confirmBulkRetire());
    await settle();

    expect(mocks.retire.mock.calls.map(([id]) => id)).toEqual(['ws-1', 'ws-2']);
    expect(run.row('ws-1')?.status).toBe(WorkspaceStatusEnum.Retired);
    expect(run.row('ws-2')?.status).toBe(WorkspaceStatusEnum.Retired);
    expect(run.row('ws-active')?.status).toBe(WorkspaceStatusEnum.Active);
    expect(run.state().workspaceOperations).toMatchObject({
      showBulkRetireConfirm: false,
      bulkOperationInFlight: false,
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith(
      m.workspace_ops_purgedCount_many({ count: 2 }),
    );
    expect(mocks.notify.error).not.toHaveBeenCalled();
    run.task.cancel();
  });

  it('keeps failed rows archived and reports successes and failures separately', async () => {
    mocks.retire.mockImplementation(async (id: string) =>
      id === 'ws-ok'
        ? { ok: true, data: retiredRow(id) }
        : id === 'ws-cow'
          ? { ok: false, error: 'nope', errorCode: 'retire-unsupported' }
          : Promise.reject(new Error('offline')),
    );
    const run = harness([archivedRow('ws-ok'), archivedRow('ws-cow'), archivedRow('ws-down')]);
    run.send(openBulkRetireConfirm({ workspaceIds: ['ws-ok', 'ws-cow', 'ws-down'] }));
    run.send(confirmBulkRetire());
    await settle();

    expect(run.row('ws-ok')?.status).toBe(WorkspaceStatusEnum.Retired);
    expect(run.row('ws-cow')?.status).toBe(WorkspaceStatusEnum.Archived);
    expect(run.row('ws-down')?.status).toBe(WorkspaceStatusEnum.Archived);
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith(
      m.workspace_ops_purgedCount_one({ count: 1 }),
    );
    expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith(
      m.workspace_ops_purgeFailedCount_many({ count: 2 }),
    );
    expect(run.state().workspaceOperations.bulkOperationInFlight).toBe(false);
    run.task.cancel();
  });

  it('stops the batch, without toasts, when the connection changes mid-batch', async () => {
    let finishFirst!: (value: unknown) => void;
    mocks.retire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    mocks.retire.mockImplementation(async (id: string) => ({ ok: true, data: retiredRow(id) }));
    const run = harness([archivedRow('ws-1'), archivedRow('ws-2'), archivedRow('ws-3')]);
    run.send(openBulkRetireConfirm({ workspaceIds: ['ws-1', 'ws-2', 'ws-3'] }));
    run.send(confirmBulkRetire());
    await settle();
    expect(mocks.retire).toHaveBeenCalledTimes(1);

    run.send(connectionStatusChanged('disconnected'));
    finishFirst({ ok: true, data: retiredRow('ws-1') });
    await settle();

    expect(mocks.retire).toHaveBeenCalledTimes(1);
    expect(run.row('ws-2')?.status).toBe(WorkspaceStatusEnum.Archived);
    expect(mocks.notify.success).not.toHaveBeenCalled();
    expect(mocks.notify.error).not.toHaveBeenCalled();
    run.task.cancel();
  });

  it('says there is nothing to purge and makes no call when no row is eligible', async () => {
    const run = harness([workspace('ws-active'), retiredRow('ws-purged')]);
    run.send(openBulkRetireConfirm({ workspaceIds: ['ws-active', 'ws-purged'] }));
    run.send(confirmBulkRetire());
    await settle();

    expect(mocks.retire).not.toHaveBeenCalled();
    expect(mocks.notify.info).toHaveBeenCalledExactlyOnceWith(
      m.workspace_ops_noFoldersToPurge_message(),
    );
    run.task.cancel();
  });
});

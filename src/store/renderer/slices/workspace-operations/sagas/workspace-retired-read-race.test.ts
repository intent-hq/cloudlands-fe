import { store } from '../../../store';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

// Uses the REAL LiveWorkspacesClient (its request de-duplication included)
// over a scripted transport, so overlapping retired reads are exercised end
// to end through the actual client seam.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
vi.mock('$lib/client', async () => {
  const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');
  return { appClient: { workspaces: new LiveWorkspacesClient() } };
});
const mocks = vi.hoisted(() => ({ unarchive: vi.fn() }));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { unarchive: mocks.unarchive },
}));
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

import {
  installMockBackend,
  resetMockBackend,
} from '../../../../../test/mocks/backend-transport.mock';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  initialState as operationsInitialState,
  loadRetiredWorkspacesRequested,
  requestUnarchiveWorkspace,
} from '../workspace-operations-slice';
import { workspaceOperationsSaga } from './workspace-operations-saga';

const R = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const wire = (id: string, status: string) => ({
  id,
  title: id,
  branch: 'b',
  status,
  archived: status !== 'Active',
  ...(status === 'Retired' ? { retiredAt: '2026-10-20T00:00:00.000Z' } : {}),
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

function harness(seed: Workspace[]) {
  const channel = stdChannel();
  let workspace = workspaceInitialState;
  for (const row of seed) workspace = workspaceReducer(workspace, setWorkspaceEntity(row));
  store.dispose();
  store.init(withLegacyPrincipal({ workspace, workspaceOperations: operationsInitialState }));
  const dispatch = (action: { type: string }) => {
    store.dispatch(action as never);
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => store.state }, workspaceOperationsSaga);
  const row = (id: string) => getItem(store.state.workspace.workspaces, id as Workspace['id']);
  return { dispatch, task, row };
}

/** Each workspace.list call gets its own deferred response, in call order. */
function scriptedLists() {
  const backend = installMockBackend();
  const pending: Array<(rows: unknown[]) => void> = [];
  backend.onRequest(
    'workspace.list',
    () => new Promise((resolve) => pending.push((rows) => resolve({ workspaces: rows }))),
  );
  return pending;
}

describe('overlapping retired reads through the real client', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    store.dispose();
    resetMockBackend();
  });

  it('a restore followed by a reactive reload leaves the workspace Active', async () => {
    const lists = scriptedLists();
    mocks.unarchive.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([
      { ...(wire(R, 'Retired') as unknown as Workspace), status: WorkspaceStatusEnum.Retired },
    ]);
    run.dispatch(loadRetiredWorkspacesRequested());
    await settle();
    run.dispatch(requestUnarchiveWorkspace(R));
    await settle();
    // The opt-in sees the last retired row disappear and reloads.
    run.dispatch(loadRetiredWorkspacesRequested());
    await settle();

    expect(lists).toHaveLength(2); // the reload is a genuinely fresh read
    lists[0]([wire(R, 'Retired')]); // stale snapshot started before the restore
    lists[1]([]); // fresh read after the restore: R is no longer retired
    await settle();
    expect(run.row(R)?.status).toBe(WorkspaceStatusEnum.Active);
    run.task.cancel();
  });

  it('a read started under an older identity never lands after an identity change', async () => {
    const lists = scriptedLists();
    const run = harness([]);
    run.dispatch(loadRetiredWorkspacesRequested());
    await settle();
    run.dispatch(connectionStatusChanged('disconnected'));
    run.dispatch(connectionStatusChanged('connected'));
    run.dispatch(loadRetiredWorkspacesRequested());
    await settle();

    expect(lists).toHaveLength(2);
    lists[0]([wire(R, 'Retired')]); // old identity's response
    lists[1]([wire(S, 'Retired')]);
    await settle();
    expect(run.row(R)).toBeUndefined();
    expect(run.row(S)?.status).toBe(WorkspaceStatusEnum.Retired);
    run.task.cancel();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), info: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  backendSubscribe: async () => ({ subscriptionId: 'workspace-home-test' }),
  backendUnsubscribe: async () => {},
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), info: mocks.info, success: vi.fn() },
}));

import { store as appStore } from '$store/renderer/store';
import { BackendError } from '$lib/client/live/backend-transport-types';
import {
  bulkUpdateWorkspaceEntities,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import { labelWorkspace } from '../../test/fixtures/workspace-labels-state';
import { workspaceHomeSaga } from './workspace-home-saga';
import {
  homeWaitRequested,
  moveHomeDialogClosed,
  moveHomeDialogOpened,
  moveHomeRequested,
} from './workspace-home-slice';
import {
  selectHomeWaiting,
  selectMoveHomeDialogWorkspaceId,
  selectMoveHomeFailure,
  selectMoveHomeSubmitting,
} from './workspace-home-selectors';

const WS = 'ws-home-saga';
const DETACHED: WorkspaceHome = {
  homeId: 'h-1',
  nodeId: 'd-mac-studio',
  name: 'Mac Studio',
  state: 'detached',
  since: '2026-11-12T09:42:00Z',
  lastBackupAt: '2026-11-12T09:41:00Z',
};
const MOVING: WorkspaceHome = {
  homeId: 'h-2',
  nodeId: 'd-garage',
  name: 'Garage node',
  state: 'moving',
  since: '2026-11-12T10:00:00Z',
  lastBackupAt: '2026-11-12T09:41:00Z',
};

const home = () => selectWorkspaceById.select(appStore.state, WS)?.home;
const dialog = () => ({
  workspaceId: selectMoveHomeDialogWorkspaceId.select(appStore.state),
  submitting: selectMoveHomeSubmitting.select(appStore.state),
  moveFailure: selectMoveHomeFailure.select(appStore.state),
});
const calls = (method: string) => mocks.request.mock.calls.filter(([name]) => name === method);

let stops: Array<() => void>;
beforeEach(() => {
  mocks.request.mockReset();
  mocks.info.mockReset();
  stops = [appStore.init()];
  appStore.dispatch(setWorkspaceEntity(labelWorkspace(WS, { home: DETACHED })));
  stops.push(appStore.runSaga(workspaceHomeSaga));
});
afterEach(() => {
  stops.reverse().forEach((stop) => stop());
});

describe('Move home', () => {
  it('sends workspace.setHome with the chosen target and shows the moving home', async () => {
    mocks.request.mockResolvedValueOnce({ home: MOVING });
    appStore.dispatch(moveHomeDialogOpened(WS));
    appStore.dispatch(moveHomeRequested(WS, { kind: 'machine', nodeId: 'd-garage' }));

    await vi.waitFor(() => expect(dialog().workspaceId).toBeNull());
    expect(calls('workspace.setHome')).toEqual([
      ['workspace.setHome', { workspaceId: WS, to: { kind: 'machine', nodeId: 'd-garage' } }],
    ]);
    expect(home()).toEqual(MOVING);
  });

  it('keeps the dialog open with the documented refusal', async () => {
    mocks.request.mockRejectedValueOnce(
      new BackendError({
        code: 'INVALID_PARAMS',
        message: 'not a home',
        rpcCode: -32602,
        data: { code: 'home-target-unavailable' },
      }),
    );
    appStore.dispatch(moveHomeDialogOpened(WS));
    appStore.dispatch(moveHomeRequested(WS, { agentId: 'agent-1' }));

    await vi.waitFor(() => expect(dialog().moveFailure).not.toBeNull());
    expect(dialog()).toMatchObject({
      workspaceId: WS,
      submitting: false,
      moveFailure: { code: 'home-target-unavailable' },
    });
    expect(home()).toEqual(DETACHED);
  });

  it('shows the move another client started when the backend says one is running', async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'workspace.setHome') {
        throw new BackendError({
          code: 'INVALID_PARAMS',
          message: 'moving',
          rpcCode: -32602,
          data: { code: 'home-moving' },
        });
      }
      return { workspace: { id: WS, title: WS, branch: 'main', status: 'Active', home: MOVING } };
    });
    appStore.dispatch(moveHomeDialogOpened(WS));
    appStore.dispatch(moveHomeRequested(WS, { kind: 'cloud', cloudMachineId: 'e2b-team' }));

    await vi.waitFor(() => expect(home()).toEqual(MOVING));
    expect(dialog().moveFailure?.code).toBe('home-moving');
  });

  it('ignores a second confirm while the first call runs', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    appStore.dispatch(moveHomeDialogOpened(WS));
    appStore.dispatch(moveHomeRequested(WS, { agentId: 'agent-1' }));
    appStore.dispatch(moveHomeRequested(WS, { agentId: 'agent-1' }));
    // A running call keeps the dialog.
    appStore.dispatch(moveHomeDialogClosed());
    expect(dialog()).toMatchObject({ workspaceId: WS, submitting: true });

    resolve({ home: MOVING });
    await vi.waitFor(() => expect(dialog().workspaceId).toBeNull());
    expect(calls('workspace.setHome')).toHaveLength(1);
  });
});

describe('Move home races', () => {
  it('keeps a newer home from workspace:updated over a late setHome reply', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    appStore.dispatch(moveHomeDialogOpened(WS));
    appStore.dispatch(moveHomeRequested(WS, { kind: 'machine', nodeId: 'd-garage' }));

    // The move finishes and its event lands before the RPC reply is handled.
    const attached: WorkspaceHome = { ...MOVING, state: 'attached', since: '2026-11-12T10:02:00Z' };
    appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(WS, { home: attached })]));
    resolve({ home: MOVING });

    await vi.waitFor(() => expect(dialog().workspaceId).toBeNull());
    expect(home()).toEqual(attached);
  });
});

describe('Wait', () => {
  it('asks the backend to reconnect the home, then shows the re-read home', async () => {
    const attached = { ...DETACHED, state: 'attached', since: '2026-11-12T10:05:00Z' };
    mocks.request.mockImplementation(async (method: string) =>
      method === 'workspace.get'
        ? { workspace: { id: WS, title: WS, branch: 'main', status: 'Active', home: attached } }
        : { machine: {} },
    );
    appStore.dispatch(homeWaitRequested(WS));
    expect(selectHomeWaiting.select(appStore.state, WS)).toBe(true);

    await vi.waitFor(() => expect(selectHomeWaiting.select(appStore.state, WS)).toBe(false));
    expect(mocks.request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['remoteMachines.refresh', { machineId: 'd-mac-studio' }],
      ['workspace.get', { workspaceId: WS }],
    ]);
    expect(home()).toEqual(attached);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('says so when the home is still unavailable', async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'remoteMachines.refresh') {
        throw new BackendError({
          code: 'INTERNAL',
          message: 'unreachable',
          rpcCode: -32603,
          data: { code: 'machine-unreachable' },
        });
      }
      return { workspace: { id: WS, title: WS, branch: 'main', status: 'Active', home: DETACHED } };
    });
    appStore.dispatch(homeWaitRequested(WS));

    await vi.waitFor(() => expect(selectHomeWaiting.select(appStore.state, WS)).toBe(false));
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(home()).toEqual(DETACHED);
  });

  it('runs one retry per workspace at a time', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation((method: string) =>
      method === 'remoteMachines.refresh'
        ? new Promise((r) => (resolve = r))
        : Promise.resolve({
            workspace: { id: WS, title: WS, branch: 'main', status: 'Active', home: DETACHED },
          }),
    );
    appStore.dispatch(homeWaitRequested(WS));
    appStore.dispatch(homeWaitRequested(WS));
    resolve({});

    await vi.waitFor(() => expect(selectHomeWaiting.select(appStore.state, WS)).toBe(false));
    expect(calls('remoteMachines.refresh')).toHaveLength(1);
  });
});

describe('Wait and the machine list', () => {
  it('keeps the refreshed machine row the backend returns', async () => {
    const machine = {
      id: 'd-mac-studio',
      name: 'Mac Studio',
      hosts: ['192.0.2.4'],
      port: 5179,
      fingerprint: 'AA:BB',
      state: 'connected',
      runningAgents: 0,
      addedAt: '2026-10-30T00:00:00Z',
    };
    mocks.request.mockImplementation(async (method: string) =>
      method === 'remoteMachines.refresh'
        ? { machine }
        : { workspace: { id: WS, title: WS, branch: 'main', status: 'Active', home: DETACHED } },
    );
    appStore.dispatch(homeWaitRequested(WS));

    await vi.waitFor(() => expect(selectHomeWaiting.select(appStore.state, WS)).toBe(false));
    expect(appStore.state.remoteMachines.machines['d-mac-studio']).toMatchObject({
      state: 'connected',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listSnapshot: undefined as any,
  update: vi.fn(),
  apply: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.list,
      update: mocks.update,
      get listSnapshot() {
        return mocks.listSnapshot;
      },
    },
  },
}));
vi.mock('$features/settings/settings-hydration-service', () => ({
  applySettingsChanges: mocks.apply,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.error, info: mocks.info }),
}));

import { BackendError } from '$lib/client/live/backend-transport-types';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

import type { StoreState } from '../../../types';
import { initialState as connectionsInitialState } from '../../connections/connections-slice';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  initialState as guestSessionsInitialState,
} from '../../guest-sessions/guest-sessions-slice';
import {
  initialState as workspaceInitialState,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import { settingsChangesReceived } from '../settings-events-slice';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  SETTINGS_HYDRATION_RETRY_DELAYS_MS,
  hydrateSettingsOnceSaga,
  settingsHydrationSaga,
} from './settings-hydration-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** Boot-time store: window identity unsettled, workspace list unloaded. */
const BOOT_STATE = {
  workspace: workspaceInitialState,
  connections: connectionsInitialState,
  guestSessions: guestSessionsInitialState,
} as StoreState;

/** Settled owner window whose loaded list reports `myRole` per workspace. */
function settledState(roles: Array<Workspace['myRole']>): StoreState {
  const workspaces = roles.map(
    (myRole, index) =>
      ({
        id: `ws-${index}` as WorkspaceId,
        title: `Workspace ${index}`,
        branch: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatusEnum.Active,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        myRole,
      }) as Workspace,
  );
  return {
    workspace: workspaceReducer(
      workspaceReducer(workspaceInitialState, replaceWorkspaceList(workspaces)),
      setWorkspaceHasLoaded(true),
    ),
    connections: connectionsInitialState,
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }),
    ),
  } as StoreState;
}

let storeState: StoreState = BOOT_STATE;
const sagaIO = { dispatch: vi.fn(), getState: () => storeState };

describe('settingsHydrationSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSnapshot = undefined;
    storeState = BOOT_STATE;
  });

  it('hydrates once in source order without issuing a persistence write', async () => {
    mocks.list.mockResolvedValue([
      {
        path: 'model.defaultProvider',
        value: 'auggie',
        origin: 'file',
        label: '',
        description: '',
      },
      { path: 'quickActions.defaultModel', value: 'fast', label: '', description: '' },
      {
        path: 'quickActions.typeOverrides',
        value: { commit: 'model' },
        label: '',
        description: '',
      },
    ]);

    await runSaga(sagaIO, hydrateSettingsOnceSaga).toPromise();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith();
    expect(mocks.apply).toHaveBeenCalledWith(
      [
        { path: 'model.defaultProvider', value: 'auggie', origin: 'file' },
        { path: 'quickActions.defaultModel', value: 'fast' },
        { path: 'quickActions.typeOverrides', value: { commit: 'model' } },
      ],
      0,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('retries an empty snapshot — the live client folds transport failures into [] (monorepo#1986)', async () => {
    vi.useFakeTimers();
    try {
      mocks.list
        .mockResolvedValueOnce([])
        .mockResolvedValue([
          { path: 'providers.enabled', value: { 'claude-code': true }, label: '', description: '' },
        ]);
      const task = runSaga(sagaIO, hydrateSettingsOnceSaga);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(mocks.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[0]);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      expect(mocks.apply).toHaveBeenCalledWith(
        [{ path: 'providers.enabled', value: { 'claude-code': true } }],
        0,
      );
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a transport-failed boot read with bounded backoff until it lands (monorepo#1986)', async () => {
    vi.useFakeTimers();
    try {
      mocks.list
        .mockRejectedValueOnce(new Error('connect ENOENT intentd.sock'))
        .mockRejectedValueOnce(new Error('connect ENOENT intentd.sock'))
        .mockResolvedValue([
          { path: 'providers.enabled', value: { 'claude-code': true }, label: '', description: '' },
        ]);
      const task = runSaga(sagaIO, hydrateSettingsOnceSaga);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(mocks.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[0]);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      expect(mocks.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[1]);
      expect(mocks.list).toHaveBeenCalledTimes(3);
      expect(mocks.apply).toHaveBeenCalledWith(
        [{ path: 'providers.enabled', value: { 'claude-code': true } }],
        0,
      );
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['INVALID_PARAMS', -32602],
    ['FORBIDDEN', -32003],
  ])('does not retry a structured daemon error response (%s)', async (code, rpcCode) => {
    mocks.list.mockRejectedValue(new BackendError({ code, message: code, rpcCode }));
    await runSaga(sagaIO, hydrateSettingsOnceSaga).toPromise();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it('treats an empty snapshot as final on a known collaborator-only client (multiplayer w3)', async () => {
    vi.useFakeTimers();
    try {
      storeState = settledState(['collaborator', 'collaborator']);
      mocks.list.mockResolvedValue([]);
      const task = runSaga(sagaIO, hydrateSettingsOnceSaga);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS.at(-1)! * 2);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(mocks.apply).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps retrying an empty snapshot on a settled owner client', async () => {
    vi.useFakeTimers();
    try {
      storeState = settledState(['collaborator', 'owner']);
      mocks.list
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ path: 'boot', value: 1, label: '', description: '' }]);
      const task = runSaga(sagaIO, hydrateSettingsOnceSaga);
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[0]);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      expect(mocks.apply).toHaveBeenCalledWith([{ path: 'boot', value: 1 }], 0);
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps retrying an empty snapshot until the client is known to be collaborator-only', async () => {
    vi.useFakeTimers();
    try {
      mocks.list.mockResolvedValue([]);
      const task = runSaga(sagaIO, hydrateSettingsOnceSaga);
      // Boot: identity unsettled reads as collaborator-only, but is not an answer yet.
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[0]);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      storeState = settledState(['collaborator']);
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[1]);
      expect(mocks.list).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS.at(-1)! * 2);
      expect(mocks.list).toHaveBeenCalledTimes(3);
      expect(mocks.apply).not.toHaveBeenCalled();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not apply a boot read that settles after cancellation', async () => {
    let resolveList!: (value: unknown[]) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const task = runSaga(sagaIO, settingsHydrationSaga);
    task.cancel();
    await task.toPromise();
    resolveList([{ path: 'model.defaultProvider', value: 'late' }]);
    await Promise.resolve();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('discards an in-flight snapshot when the backend changes and reads the new backend', async () => {
    let resolveOldSnapshot!: (value: unknown) => void;
    mocks.listSnapshot = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldSnapshot = resolve;
        }),
      )
      .mockResolvedValueOnce({ settings: [{ path: 'backend', value: 'new' }], revision: 1 });
    const input = stdChannel();
    const task = runSaga({ ...sagaIO, channel: input }, settingsHydrationSaga);
    await settle();

    input.put({
      type: 'connections/listReceived',
      payload: [{ connections: [], activeId: 'new', windowBackendId: 'new' }],
    });
    await settle();

    expect(mocks.listSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith([{ path: 'backend', value: 'new' }], 1);

    resolveOldSnapshot({ settings: [{ path: 'backend', value: 'old' }], revision: 99 });
    await settle();
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith([{ path: 'backend', value: 'new' }], 1);

    task.cancel();
    await task.toPromise();
  });

  it('buffers changes during boot hydration and applies each bundle atomically in order', async () => {
    let resolveList!: (value: unknown[]) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const input = stdChannel();
    const task = runSaga({ ...sagaIO, channel: input }, settingsHydrationSaga);
    input.put(settingsChangesReceived([{ path: 'first', value: 1 }]));
    input.put(
      settingsChangesReceived([
        { path: 'second.a', value: 2 },
        { path: 'second.b', value: 3 },
      ]),
    );
    resolveList([{ path: 'boot', value: 0 }]);
    await settle();

    expect(mocks.apply.mock.calls).toEqual([
      [[{ path: 'boot', value: 0 }], 0],
      [[{ path: 'first', value: 1 }], undefined],
      [
        [
          { path: 'second.a', value: 2 },
          { path: 'second.b', value: 3 },
        ],
        undefined,
      ],
    ]);
    task.cancel();
    await task.toPromise();
    input.put(settingsChangesReceived([{ path: 'late', value: 4 }]));
    await settle();
    expect(mocks.apply).toHaveBeenCalledTimes(3);
  });

  it('ignores stale revisions and resets the watermark when the window backend changes', async () => {
    mocks.listSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ settings: [{ path: 'boot', value: 5 }], revision: 5 })
      .mockResolvedValueOnce({ settings: [{ path: 'remote', value: 1 }], revision: 1 });
    const input = stdChannel();
    const task = runSaga({ ...sagaIO, channel: input }, settingsHydrationSaga);
    await settle();

    input.put(settingsChangesReceived([{ path: 'stale', value: 4 }], 4));
    input.put(settingsChangesReceived([{ path: 'newer', value: 6 }], 6));
    await settle();
    expect(mocks.apply.mock.calls).toEqual([
      [[{ path: 'boot', value: 5 }], 5],
      [[{ path: 'newer', value: 6 }], 6],
    ]);

    input.put({
      type: 'connections/listReceived',
      payload: [{ connections: [], activeId: 'remote', windowBackendId: 'remote' }],
    });
    await settle();
    expect(mocks.apply).toHaveBeenLastCalledWith([{ path: 'remote', value: 1 }], 1);

    task.cancel();
    await task.toPromise();
  });

  it('resets the watermark when the same backend reconnects after a daemon restart', async () => {
    mocks.listSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ settings: [{ path: 'boot', value: 10 }], revision: 10 })
      .mockResolvedValueOnce({ settings: [{ path: 'restarted', value: 0 }], revision: 0 });
    const input = stdChannel();
    const task = runSaga({ ...sagaIO, channel: input }, settingsHydrationSaga);
    await settle();

    input.put(settingsChangesReceived([{ path: 'before-restart', value: 11 }], 11));
    await settle();
    input.put(backendReconnected());
    await settle();
    input.put(settingsChangesReceived([{ path: 'after-restart', value: 1 }], 1));
    await settle();

    expect(mocks.apply.mock.calls).toEqual([
      [[{ path: 'boot', value: 10 }], 10],
      [[{ path: 'before-restart', value: 11 }], 11],
      [[{ path: 'restarted', value: 0 }], 0],
      [[{ path: 'after-restart', value: 1 }], 1],
    ]);

    task.cancel();
    await task.toPromise();
  });

  it('keeps monotonic revision filtering after an ordinary reconnect', async () => {
    mocks.listSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ settings: [{ path: 'boot', value: 5 }], revision: 5 })
      .mockResolvedValueOnce({ settings: [{ path: 'reconnected', value: 7 }], revision: 7 });
    const input = stdChannel();
    const task = runSaga({ ...sagaIO, channel: input }, settingsHydrationSaga);
    await settle();

    input.put(backendReconnected());
    await settle();
    input.put(settingsChangesReceived([{ path: 'stale', value: 6 }], 6));
    input.put(settingsChangesReceived([{ path: 'newer', value: 8 }], 8));
    await settle();

    expect(mocks.apply.mock.calls).toEqual([
      [[{ path: 'boot', value: 5 }], 5],
      [[{ path: 'reconnected', value: 7 }], 7],
      [[{ path: 'newer', value: 8 }], 8],
    ]);

    task.cancel();
    await task.toPromise();
  });
});

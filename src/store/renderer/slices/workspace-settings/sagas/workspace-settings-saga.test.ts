import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  warn: vi.fn(),
  getWorkspaceSettings: vi.fn(),
}));

vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { getWorkspaceSettings: mocks.getWorkspaceSettings } },
}));

import { SETTINGS_CHANNELS, WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  refreshAutoCommitSettings,
  setAutoCommitEnabled,
  syncWorkspaceSettings,
  workspaceSettingsReducer,
} from '../workspace-settings-slice';
import { workspaceSettingsSaga } from './workspace-settings-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga() {
  let workspaceSettings = workspaceSettingsReducer(undefined, { type: '@@init' } as never);
  const dispatched: Array<{ type: string }> = [];
  const input = stdChannel();
  const task = runSaga(
    {
      channel: input,
      dispatch: (action: { type: string }) => {
        dispatched.push(action);
        workspaceSettings = workspaceSettingsReducer(workspaceSettings, action as never);
      },
      getState: () => ({ workspaceSettings }),
    },
    workspaceSettingsSaga,
  );
  const send = (action: ReturnType<typeof setAutoCommitEnabled> | { type: string }) => {
    workspaceSettings = workspaceSettingsReducer(workspaceSettings, action as never);
    input.put(action as never);
  };
  return { send, task, dispatched, getSettingsState: () => workspaceSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electronAPI', {});
  mocks.invoke.mockResolvedValue({ success: true, data: {} });
  mocks.getWorkspaceSettings.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspaceSettingsSaga', () => {
  it('writes the exact post-state value to the workspace IPC channel only', async () => {
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('never writes the legacy global settings channel (regression: global git.autoCommit stomp)', async () => {
    // Even in an Electron build (electronAPI present via beforeEach), toggling
    // one workspace must not write `settings:set { key: 'autoCommit' }` — that
    // channel maps to the daemon's GLOBAL `git.autoCommit` setting.
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', true));
    send(setAutoCommitEnabled('ws-2', false));
    await settle();

    const globalWrites = mocks.invoke.mock.calls.filter(
      ([channel]) => channel === SETTINGS_CHANNELS.SET,
    );
    expect(globalWrites).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('logs exact context when the workspace IPC write fails and makes no other writes', async () => {
    const error = new Error('workspace unavailable');
    mocks.invoke.mockRejectedValueOnce(error);
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', true));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
    ]);
    expect(mocks.warn.mock.calls).toEqual([
      [
        'Failed to sync autoCommit to main process',
        { workspaceId: 'ws-1', autoCommitEnabled: true, error },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('logs exact context when the write resolves a failure envelope (regression: silently swallowed success:false)', async () => {
    // Both builds resolve a CommandResponse envelope instead of rejecting on a
    // daemon write failure (Electron main safe handler + web-build bridge), so
    // the worker must treat `success: false` as a failure, not ignore it.
    mocks.invoke.mockResolvedValueOnce({ success: false, error: 'daemon write failed' });
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', true));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
    ]);
    expect(mocks.warn.mock.calls).toEqual([
      [
        'Failed to sync autoCommit to main process',
        { workspaceId: 'ws-1', autoCommitEnabled: true, error: 'daemon write failed' },
      ],
    ]);

    // The worker recovers: a later toggle still writes (and a success envelope
    // produces no warning).
    send(setAutoCommitEnabled('ws-1', false));
    await settle();
    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
    ]);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('ignores unrelated actions', async () => {
    const { send, task } = startSaga();
    send({ type: 'unrelated/action' });
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([]);
    expect(mocks.warn.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('serializes per workspace, retains only the latest queued value, and runs workspaces independently', async () => {
    let releaseWs1!: () => void;
    let blocked = false;
    mocks.invoke.mockImplementation((channel: string, payload: unknown) => {
      if (
        channel === WORKSPACE_CHANNELS.UPDATE_SETTINGS &&
        (payload as { id?: string }).id === 'ws-1' &&
        !blocked
      ) {
        blocked = true;
        return new Promise<void>((resolve) => {
          releaseWs1 = resolve;
        });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', true));
    await settle();
    send(setAutoCommitEnabled('ws-1', false));
    send(setAutoCommitEnabled('ws-1', true));
    send(setAutoCommitEnabled('ws-2', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-2', settings: { autoCommitEnabled: false } }],
    ]);

    releaseWs1();
    await settle();
    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-2', settings: { autoCommitEnabled: false } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('continues with the latest queued value after a partial failure', async () => {
    let rejectFirst!: (error: Error) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', false));
    await settle();
    send(setAutoCommitEnabled('ws-1', true));
    rejectFirst(new Error('first failed'));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('closes keyed queues on cancellation and does not flush buffered or follow-on writes', async () => {
    let release!: () => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', false));
    await settle();
    send(setAutoCommitEnabled('ws-1', true));
    task.cancel();
    await task.toPromise();
    release();
    await settle();
    send(setAutoCommitEnabled('ws-2', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
    ]);
  });

  describe('hydration from the daemon (workspace.getAutoCommit)', () => {
    it('hydrates on workspaceMounted and loads the daemon-resolved value into state', async () => {
      mocks.getWorkspaceSettings.mockResolvedValueOnce({ autoCommitEnabled: false });
      const { send, task, dispatched, getSettingsState } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([['ws-1']]);
      expect(dispatched).toEqual([setAutoCommitEnabled('ws-1', false)]);
      expect(getSettingsState().byWorkspaceId['ws-1']?.autoCommitEnabled).toBe(false);
      task.cancel();
      await task.toPromise();
    });

    it('hydrates on syncWorkspaceSettings', async () => {
      mocks.getWorkspaceSettings.mockResolvedValueOnce({ autoCommitEnabled: true });
      const { send, task, dispatched } = startSaga();
      send(syncWorkspaceSettings('ws-1'));
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([['ws-1']]);
      expect(dispatched).toEqual([setAutoCommitEnabled('ws-1', true)]);
      task.cancel();
      await task.toPromise();
    });

    it('does not write back to the daemon when hydrating (read-only)', async () => {
      mocks.getWorkspaceSettings.mockResolvedValueOnce({ autoCommitEnabled: false });
      const { send, task } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();

      expect(mocks.invoke.mock.calls).toEqual([]);
      task.cancel();
      await task.toPromise();
    });

    it('keeps current state and warns when the daemon read returns null', async () => {
      mocks.getWorkspaceSettings.mockResolvedValueOnce(null);
      const { send, task, dispatched } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();

      expect(dispatched).toEqual([]);
      expect(mocks.warn.mock.calls).toEqual([
        [
          'workspace.getAutoCommit returned no value; keeping current toggle state',
          { workspaceId: 'ws-1' },
        ],
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('keeps current state and warns when the daemon read throws', async () => {
      const error = new Error('daemon unavailable');
      mocks.getWorkspaceSettings.mockRejectedValueOnce(error);
      const { send, task, dispatched } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();

      expect(dispatched).toEqual([]);
      expect(mocks.warn.mock.calls).toEqual([
        ['Failed to hydrate auto-commit settings from daemon', { workspaceId: 'ws-1', error }],
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('drops the stale read when the user toggles the same workspace mid-hydration', async () => {
      let resolveRead!: (value: { autoCommitEnabled: boolean }) => void;
      mocks.getWorkspaceSettings.mockImplementationOnce(
        () =>
          new Promise<{ autoCommitEnabled: boolean }>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const { send, task, dispatched, getSettingsState } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();
      send(setAutoCommitEnabled('ws-1', false));
      await settle();
      resolveRead({ autoCommitEnabled: true });
      await settle();

      // The user's toggle (false) wins; the stale daemon read (true) is dropped.
      expect(dispatched).toEqual([]);
      expect(getSettingsState().byWorkspaceId['ws-1']?.autoCommitEnabled).toBe(false);
      task.cancel();
      await task.toPromise();
    });

    it('is single-flight per workspace: concurrent triggers share one read', async () => {
      let resolveRead!: (value: { autoCommitEnabled: boolean }) => void;
      mocks.getWorkspaceSettings.mockImplementationOnce(
        () =>
          new Promise<{ autoCommitEnabled: boolean }>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const { send, task, dispatched } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();
      send(syncWorkspaceSettings('ws-1'));
      send(workspaceMounted('ws-1'));
      await settle();
      resolveRead({ autoCommitEnabled: false });
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([['ws-1']]);
      expect(dispatched).toEqual([setAutoCommitEnabled('ws-1', false)]);
      task.cancel();
      await task.toPromise();
    });

    it('re-hydrates every tracked workspace on refreshAutoCommitSettings', async () => {
      mocks.getWorkspaceSettings
        .mockResolvedValueOnce({ autoCommitEnabled: true })
        .mockResolvedValueOnce({ autoCommitEnabled: false })
        .mockResolvedValueOnce({ autoCommitEnabled: true })
        .mockResolvedValueOnce({ autoCommitEnabled: true });
      const { send, task, dispatched, getSettingsState } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();
      send(workspaceMounted('ws-2'));
      await settle();
      // Global git.autoCommit was saved; both tracked workspaces re-read.
      send(refreshAutoCommitSettings());
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([
        ['ws-1'],
        ['ws-2'],
        ['ws-1'],
        ['ws-2'],
      ]);
      expect(dispatched).toEqual([
        setAutoCommitEnabled('ws-1', true),
        setAutoCommitEnabled('ws-2', false),
        setAutoCommitEnabled('ws-1', true),
        setAutoCommitEnabled('ws-2', true),
      ]);
      expect(getSettingsState().byWorkspaceId['ws-2']?.autoCommitEnabled).toBe(true);
      task.cancel();
      await task.toPromise();
    });

    it('a refresh arriving mid-sweep restarts the sweep (takeLatest) so all workspaces converge', async () => {
      const pending: Array<(value: { autoCommitEnabled: boolean }) => void> = [];
      mocks.getWorkspaceSettings
        .mockResolvedValueOnce({ autoCommitEnabled: false })
        .mockResolvedValueOnce({ autoCommitEnabled: false })
        .mockImplementation(
          () =>
            new Promise<{ autoCommitEnabled: boolean }>((resolve) => {
              pending.push(resolve);
            }),
        );
      const { send, task, dispatched } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();
      send(workspaceMounted('ws-2'));
      await settle();
      dispatched.length = 0;

      // First sweep: ws-1 read is in flight when a second save fires.
      send(refreshAutoCommitSettings());
      await settle();
      send(refreshAutoCommitSettings());
      await settle();
      // Cancelled first sweep's ws-1 read resolving late must be ignored;
      // the restarted sweep re-reads both workspaces with the latest value.
      for (const resolve of pending.splice(0)) resolve({ autoCommitEnabled: true });
      await settle();
      for (const resolve of pending.splice(0)) resolve({ autoCommitEnabled: true });
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls.slice(2)).toEqual([
        ['ws-1'],
        ['ws-1'],
        ['ws-2'],
      ]);
      expect(dispatched).toEqual([
        setAutoCommitEnabled('ws-1', true),
        setAutoCommitEnabled('ws-2', true),
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('refresh skips a workspace whose mount hydration is still in flight (no duplicate read)', async () => {
      let resolveMountRead!: (value: { autoCommitEnabled: boolean }) => void;
      mocks.getWorkspaceSettings
        .mockResolvedValueOnce({ autoCommitEnabled: true })
        .mockImplementationOnce(
          () =>
            new Promise<{ autoCommitEnabled: boolean }>((resolve) => {
              resolveMountRead = resolve;
            }),
        )
        .mockResolvedValue({ autoCommitEnabled: false });
      const { send, task, dispatched } = startSaga();
      send(workspaceMounted('ws-1'));
      await settle();
      // ws-2's mount read is left hanging while the refresh sweep runs.
      send(workspaceMounted('ws-2'));
      await settle();
      dispatched.length = 0;

      send(refreshAutoCommitSettings());
      await settle();
      resolveMountRead({ autoCommitEnabled: true });
      await settle();

      // Sweep re-read ws-1 only; ws-2 kept its single in-flight mount read.
      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([['ws-1'], ['ws-2'], ['ws-1']]);
      expect(dispatched).toEqual([
        setAutoCommitEnabled('ws-1', false),
        setAutoCommitEnabled('ws-2', true),
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('refresh with no tracked workspaces makes no daemon reads', async () => {
      const { send, task, dispatched } = startSaga();
      send(refreshAutoCommitSettings());
      await settle();

      expect(mocks.getWorkspaceSettings.mock.calls).toEqual([]);
      expect(dispatched).toEqual([]);
      task.cancel();
      await task.toPromise();
    });
  });
});

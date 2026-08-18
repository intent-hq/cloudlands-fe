import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import { SETTINGS_CHANNELS, WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { setAutoCommitEnabled, workspaceSettingsReducer } from '../workspace-settings-slice';
import { workspaceSettingsSaga } from './workspace-settings-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga() {
  let workspaceSettings = workspaceSettingsReducer(undefined, { type: '@@init' } as never);
  const input = stdChannel();
  const task = runSaga(
    { channel: input, dispatch: vi.fn(), getState: () => ({ workspaceSettings }) },
    workspaceSettingsSaga,
  );
  const send = (action: ReturnType<typeof setAutoCommitEnabled> | { type: string }) => {
    workspaceSettings = workspaceSettingsReducer(workspaceSettings, action as never);
    input.put(action as never);
  };
  return { send, task };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electronAPI', {});
  mocks.invoke.mockResolvedValue({ success: true, data: {} });
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
});

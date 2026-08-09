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
  mocks.invoke.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspaceSettingsSaga', () => {
  it('writes the exact post-state value to workspace IPC before global settings IPC', async () => {
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: false }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('continues to global persistence after workspace IPC fails and logs exact context', async () => {
    const error = new Error('workspace unavailable');
    mocks.invoke.mockRejectedValueOnce(error).mockResolvedValueOnce({ ok: true });
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', true));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: true }],
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

  it('logs global persistence failure after the successful workspace write', async () => {
    const error = new Error('settings unavailable');
    mocks.invoke.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(error);
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-2', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-2', settings: { autoCommitEnabled: false } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: false }],
    ]);
    expect(mocks.warn.mock.calls).toEqual([
      ['Failed to persist autoCommit to electron-store', { autoCommitEnabled: false, error }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('skips global settings IPC outside the Electron bridge', async () => {
    vi.stubGlobal('electronAPI', undefined);
    const { send, task } = startSaga();
    send(setAutoCommitEnabled('ws-1', false));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: false } }],
    ]);
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
      return Promise.resolve({ ok: true });
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
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: false }],
    ]);

    releaseWs1();
    await settle();
    expect(mocks.invoke.mock.calls).toEqual([
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-2', settings: { autoCommitEnabled: false } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: false }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: true }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: true }],
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
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: false }],
      [WORKSPACE_CHANNELS.UPDATE_SETTINGS, { id: 'ws-1', settings: { autoCommitEnabled: true } }],
      [SETTINGS_CHANNELS.SET, { key: 'autoCommit', value: true }],
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

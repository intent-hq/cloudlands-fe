import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSetting: vi.fn(),
  updateSettings: vi.fn(),
  createTerminal: vi.fn(),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: mocks.getSetting, update: mocks.updateSettings },
    terminals: { create: mocks.createTerminal },
  },
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { addTerminal, openTerminalOverlay } from '../../terminals/terminals-slice';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsRequested,
  checkHostRequirementsStarted,
  ensureHostRequirementsChecked,
  ghRequirementResolved,
  gitRequirementResolved,
  nodeRequirementResolved,
  initializeRtkSettings,
  installRtkRequested,
  rtkRequirementResolved,
  rtkSettingLoaded,
  rtkUpdateFailed,
  rtkUpdateStarted,
  rtkUpdateSucceeded,
  updateRtkEnabledRequested,
} from '../host-requirements-slice';
import { hostRequirementsSaga } from './host-requirements-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(hasCheckedOnce = false) {
  const channel = stdChannel();
  const dispatch = vi.fn((action) => channel.put(action));
  const task = runSaga(
    { channel, dispatch, getState: () => ({ hostRequirements: { hasCheckedOnce } }) },
    hostRequirementsSaga,
  );
  return { channel, dispatch, task };
}

describe('hostRequirementsSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('fans out exact IPC probes and maps only the terminal payload fields', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.SYSTEM.CHECK_GIT) {
        return { success: true, data: { available: true, version: 'git 2.45', wireOnly: 'drop' } };
      }
      if (channel === IPC_CHANNELS.SYSTEM.CHECK_GH) {
        return { success: true, data: { available: true, version: '2.62.0', wireOnly: 'drop' } };
      }
      return {
        success: true,
        data: { available: true, versionOk: false, version: '18.0', wireOnly: 'drop' },
      };
    });
    const { channel, dispatch, task } = harness();
    channel.put(checkHostRequirementsRequested());
    await settle();

    expect(mocks.invoke.mock.calls.map(([name]) => name).sort()).toEqual(
      [
        IPC_CHANNELS.SYSTEM.CHECK_GIT,
        IPC_CHANNELS.SYSTEM.CHECK_GH,
        IPC_CHANNELS.SYSTEM.CHECK_NODE,
      ].sort(),
    );
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      checkHostRequirementsStarted(),
      gitRequirementResolved(true, 'git 2.45'),
      nodeRequirementResolved(false, '18.0'),
      ghRequirementResolved(true, '2.62.0'),
      checkHostRequirementsComplete(),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('skips ensure after hydration and coalesces ensure with an explicit check', async () => {
    const skippedRun = harness(true);
    skippedRun.channel.put(ensureHostRequirementsChecked());
    await settle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    skippedRun.task.cancel();
    await skippedRun.task.toPromise();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.invoke.mockImplementation(async () => {
      await gate;
      return { success: false };
    });
    const { channel, task } = harness();
    channel.put(checkHostRequirementsRequested());
    channel.put(ensureHostRequirementsChecked());
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    release();
    await settle();
    task.cancel();
    await task.toPromise();
  });

  it('dispatches group completion when an in-flight check is cancelled', async () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const { channel, dispatch, task } = harness();
    channel.put(checkHostRequirementsRequested());
    await settle();
    task.cancel();
    await task.toPromise();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      checkHostRequirementsStarted(),
      checkHostRequirementsComplete(),
    ]);
  });

  it('loads the RTK setting and host availability through their exact seams', async () => {
    mocks.getSetting.mockResolvedValue({ path: 'rtk.enabled', value: true });
    mocks.invoke.mockResolvedValue({ success: true, data: { available: true } });
    const { channel, dispatch, task } = harness();
    channel.put(initializeRtkSettings());
    await settle();

    expect(mocks.getSetting.mock.calls).toEqual([['rtk.enabled']]);
    expect(mocks.invoke.mock.calls).toEqual([[IPC_CHANNELS.SYSTEM.CHECK_RTK]]);
    const actions = dispatch.mock.calls.map(([action]) => action);
    expect(actions).toContainEqual(rtkSettingLoaded(true));
    expect(actions).toContainEqual(rtkRequirementResolved(true));
    task.cancel();
    await task.toPromise();
  });

  it('settles RTK setting updates on success and failure', async () => {
    mocks.updateSettings
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('settings unavailable'));
    const { channel, dispatch, task } = harness();
    channel.put(updateRtkEnabledRequested(true));
    await settle();
    channel.put(updateRtkEnabledRequested(false));
    await settle();

    expect(mocks.updateSettings.mock.calls).toEqual([
      [[{ path: 'rtk.enabled', value: true }]],
      [[{ path: 'rtk.enabled', value: false }]],
    ]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      rtkUpdateStarted(),
      rtkUpdateSucceeded(true),
      rtkUpdateStarted(),
      rtkUpdateFailed(m.settings_rtk_saveError()),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('creates the install terminal with the command in the initial protocol request', async () => {
    mocks.createTerminal.mockResolvedValue({ success: true, id: 'term-rtk' });
    const { channel, dispatch, task } = harness();
    channel.put(installRtkRequested());
    await settle();

    expect(mocks.createTerminal.mock.calls).toEqual([
      [{ workspaceId: ROOT_WORKSPACE_ID, cols: 80, rows: 24, command: 'brew install rtk' }],
    ]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      addTerminal(ROOT_WORKSPACE_ID, 'term-rtk', m.settings_rtk_installTerminalTitle()),
      openTerminalOverlay(ROOT_WORKSPACE_ID, 'term-rtk'),
    ]);
    task.cancel();
    await task.toPromise();
  });
});

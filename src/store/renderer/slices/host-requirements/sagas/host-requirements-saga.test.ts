import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsRequested,
  checkHostRequirementsStarted,
  ensureHostRequirementsChecked,
  ghRequirementResolved,
  gitRequirementResolved,
  nodeRequirementResolved,
} from '../host-requirements-slice';
import { hostRequirementsSaga } from './host-requirements-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

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
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ hostRequirements: { hasCheckedOnce: false } }) },
      hostRequirementsSaga,
    );
    channel.put(checkHostRequirementsRequested());
    await settle();

    expect(mocks.invoke.mock.calls.map(([name]) => name).sort()).toEqual(
      [IPC_CHANNELS.SYSTEM.CHECK_GIT, IPC_CHANNELS.SYSTEM.CHECK_GH, IPC_CHANNELS.SYSTEM.CHECK_NODE].sort(),
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

  it('skips ensure after hydration and coalesces overlapping explicit checks', async () => {
    const skippedChannel = stdChannel();
    const skipped = runSaga(
      {
        channel: skippedChannel,
        dispatch: vi.fn(),
        getState: () => ({ hostRequirements: { hasCheckedOnce: true } }),
      },
      hostRequirementsSaga,
    );
    skippedChannel.put(ensureHostRequirementsChecked());
    await settle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    skipped.cancel();
    await skipped.toPromise();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.invoke.mockImplementation(async () => {
      await gate;
      return { success: false };
    });
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: vi.fn(),
        getState: () => ({ hostRequirements: { hasCheckedOnce: false } }),
      },
      hostRequirementsSaga,
    );
    channel.put(checkHostRequirementsRequested());
    channel.put(checkHostRequirementsRequested());
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    release();
    await settle();
    task.cancel();
    await task.toPromise();
  });

  it('dispatches group completion when an in-flight check is cancelled', async () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ hostRequirements: { hasCheckedOnce: false } }) },
      hostRequirementsSaga,
    );
    channel.put(checkHostRequirementsRequested());
    await settle();
    task.cancel();
    await task.toPromise();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      checkHostRequirementsStarted(),
      checkHostRequirementsComplete(),
    ]);
  });
});

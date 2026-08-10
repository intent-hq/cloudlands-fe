import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  callbacks: {} as Record<string, (value?: any) => void>,
  disposers: Array.from({ length: 5 }, () => vi.fn()),
  getState: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
}));
vi.mock('$features/auto-update/auto-update.client', () => ({
  autoUpdateClient: {
    getState: mocks.getState,
    downloadUpdate: mocks.download,
    installUpdate: mocks.install,
    onShowToast: (callback: () => void) => {
      mocks.callbacks.toast = callback;
      return mocks.disposers[0];
    },
    onUpToDate: (callback: (value: any) => void) => {
      mocks.callbacks.current = callback;
      return mocks.disposers[1];
    },
    onStatusChanged: (callback: (value: any) => void) => {
      mocks.callbacks.status = callback;
      return mocks.disposers[2];
    },
    onProgress: (callback: (value: any) => void) => {
      mocks.callbacks.progress = callback;
      return mocks.disposers[3];
    },
    onError: (callback: (value: any) => void) => {
      mocks.callbacks.error = callback;
      return mocks.disposers[4];
    },
  },
}));

import {
  downloadUpdate,
  initAutoUpdate,
  installUpdate,
  setCheckTimedOut,
  setProgress,
  setUpToDate,
  setUpdateError,
  setUpdateState,
  showToast,
  showToastChecking,
} from '../auto-update-slice';
import { autoUpdateSaga, CHECK_TIMEOUT_MS } from './auto-update-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** Like `settle`, but also flushes fake-timer-scheduled microtasks (watchdog tests). */
const settleFake = async () => {
  await settle();
  await vi.advanceTimersByTimeAsync(0);
};

const state = (version: string) => ({
  status: 'available' as const,
  currentVersion: version,
  updateInfo: {
    version: '2.0.0',
    releaseDate: '2026-07-30',
    releaseNotes: 'notes',
    wireOnly: 'drop',
  },
  progress: null,
  error: null,
  channel: 'stable' as const,
  wireOnly: 'drop',
});

describe('autoUpdateSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mocks.callbacks)) delete mocks.callbacks[key];
  });
  afterEach(() => vi.clearAllMocks());

  it('maps every listener event to exact actions and drops wire-only object fields', async () => {
    mocks.getState.mockResolvedValue(state('initial'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
      autoUpdateSaga,
    );
    channel.put(initAutoUpdate());
    await settle();
    dispatch.mockClear();

    mocks.callbacks.toast();
    mocks.callbacks.current({ version: '1.0.0', isDev: true, wireOnly: 'drop' });
    mocks.callbacks.status(state('available-event'));
    mocks.callbacks.progress({
      percent: 25,
      bytesPerSecond: 100,
      transferred: 25,
      total: 100,
      wireOnly: 'drop',
    });
    mocks.callbacks.error('event failed');
    mocks.callbacks.status({
      ...state('downloaded-event'),
      status: 'downloaded',
      progress: {
        percent: 100,
        bytesPerSecond: 200,
        transferred: 100,
        total: 100,
        wireOnly: 'drop',
      },
    });
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      showToastChecking(),
      setUpToDate('1.0.0'),
      showToast(),
      setUpdateState({
        status: 'available',
        currentVersion: 'available-event',
        updateInfo: { version: '2.0.0', releaseDate: '2026-07-30', releaseNotes: 'notes' },
        progress: null,
        error: null,
        channel: 'stable',
      }),
      setProgress({ percent: 25, bytesPerSecond: 100, transferred: 25, total: 100 }),
      setUpdateError('event failed'),
      setUpdateState({
        status: 'downloaded',
        currentVersion: 'downloaded-event',
        updateInfo: { version: '2.0.0', releaseDate: '2026-07-30', releaseNotes: 'notes' },
        progress: { percent: 100, bytesPerSecond: 200, transferred: 100, total: 100 },
        error: null,
        channel: 'stable',
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('registers listener-first once, maps exact snapshots, and disposes every listener', async () => {
    let resolveInitial!: (value: any) => void;
    mocks.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
      autoUpdateSaga,
    );
    channel.put(initAutoUpdate());
    await settle();
    expect(Object.keys(mocks.callbacks).sort()).toEqual([
      'current',
      'error',
      'progress',
      'status',
      'toast',
    ]);

    mocks.callbacks.status(state('event'));
    await settle();
    expect(dispatch).toHaveBeenCalledWith(
      setUpdateState({
        status: 'available',
        currentVersion: 'event',
        updateInfo: { version: '2.0.0', releaseDate: '2026-07-30', releaseNotes: 'notes' },
        progress: null,
        error: null,
        channel: 'stable',
      }),
    );
    resolveInitial(state('initial'));
    await settle();
    channel.put(initAutoUpdate());
    await settle();
    expect(mocks.getState).toHaveBeenCalledTimes(1);

    task.cancel();
    await task.toPromise();
    expect(mocks.disposers.map((dispose) => dispose.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('surfaces download/install failures but suppresses a raced download error', async () => {
    mocks.download.mockRejectedValue(new Error('download failed'));
    mocks.install.mockRejectedValue(new Error('install failed'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
      autoUpdateSaga,
    );
    channel.put(downloadUpdate());
    channel.put(installUpdate());
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setUpdateError('download failed'),
      setUpdateError('install failed'),
    ]);
    task.cancel();
    await task.toPromise();

    dispatch.mockClear();
    const racedChannel = stdChannel();
    const raced = runSaga(
      {
        channel: racedChannel,
        dispatch,
        getState: () => ({ autoUpdate: { status: 'downloading' } }),
      },
      autoUpdateSaga,
    );
    racedChannel.put(downloadUpdate());
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    raced.cancel();
    await raced.toPromise();
  });

  // Renderer-side watchdog (intent-hq/monorepo#1698): the main-process
  // "checking" status can go un-terminated (deduped hung check, null
  // checkForUpdates result), so the saga arms its own timer as a safety
  // net independent of any main-process event ever arriving.
  it('dispatches setCheckTimedOut when the watchdog fires while still checking', async () => {
    vi.useFakeTimers();
    try {
      mocks.getState.mockResolvedValue(state('initial'));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
        autoUpdateSaga,
      );
      channel.put(initAutoUpdate());
      await settleFake();
      dispatch.mockClear();

      mocks.callbacks.toast();
      await settleFake();
      expect(dispatch).toHaveBeenCalledWith(showToastChecking());
      dispatch.mockClear();

      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
      await settleFake();
      expect(dispatch).not.toHaveBeenCalledWith(setCheckTimedOut());

      await vi.advanceTimersByTimeAsync(1);
      await settleFake();
      expect(dispatch).toHaveBeenCalledWith(setCheckTimedOut());

      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending watchdog when a terminal status event lands first', async () => {
    vi.useFakeTimers();
    try {
      mocks.getState.mockResolvedValue(state('initial'));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
        autoUpdateSaga,
      );
      channel.put(initAutoUpdate());
      await settleFake();
      dispatch.mockClear();

      mocks.callbacks.toast();
      await settleFake();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS / 2);
      mocks.callbacks.status(state('available-event'));
      await settleFake();
      dispatch.mockClear();

      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      await settleFake();
      expect(dispatch).not.toHaveBeenCalledWith(setCheckTimedOut());

      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the watchdog on a repeated manual check with no leaked prior timer', async () => {
    vi.useFakeTimers();
    try {
      mocks.getState.mockResolvedValue(state('initial'));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => ({ autoUpdate: { status: 'idle' } }) },
        autoUpdateSaga,
      );
      channel.put(initAutoUpdate());
      await settleFake();
      dispatch.mockClear();

      mocks.callbacks.toast();
      await settleFake();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS * 0.6);
      mocks.callbacks.toast();
      await settleFake();
      dispatch.mockClear();

      // If the first timer were not cancelled, it would fire around here.
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS * 0.4);
      await settleFake();
      expect(dispatch).not.toHaveBeenCalledWith(setCheckTimedOut());

      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS * 0.6);
      await settleFake();
      expect(dispatch).toHaveBeenCalledWith(setCheckTimedOut());
      expect(
        dispatch.mock.calls.filter(([action]) => action.type === setCheckTimedOut.type),
      ).toHaveLength(1);

      task.cancel();
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });
});

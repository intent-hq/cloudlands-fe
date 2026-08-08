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
  setProgress,
  setUpToDate,
  setUpdateError,
  setUpdateState,
  showToast,
  showToastChecking,
} from '../auto-update-slice';
import { autoUpdateSaga } from './auto-update-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
});

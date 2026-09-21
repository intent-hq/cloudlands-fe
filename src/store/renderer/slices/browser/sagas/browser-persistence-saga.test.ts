import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(() => null),
  getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  keysWithPrefix: vi.fn(() => []),
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));
vi.mock('$lib/utils/safe-storage', () => ({ safeLocalStorage: storage }));

import type { StoreState } from '../../../types';
import {
  addRecentUrl,
  clearRecentUrls,
  initBrowserWorkspace,
  removeRecentUrl,
  updateUrlMetadata,
} from '../browser-slice';
import type { RecentUrl } from '../browser-types';
import { browserPersistenceSaga, hydrateBrowserWorkspaceWorker } from './browser-persistence-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const recent = (index: number): RecentUrl => ({
  url: `https://example.com/${index}`,
  title: `Page ${index}`,
  favicon: `https://example.com/${index}.ico`,
  lastVisited: `2026-07-30T00:00:${String(index).padStart(2, '0')}Z`,
});

const persisted = [recent(1), recent(2)];
function state(): StoreState {
  return {
    browser: {
      byWorkspaceId: {
        'ws-1': {
          recentUrls: persisted,
          currentUrl: null,
          isLoading: false,
          pendingZoomByTabId: {},
        },
      },
    },
  } as unknown as StoreState;
}

describe('browserPersistenceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getJSON.mockReturnValue(undefined);
  });

  it('hydrates exact valid stored objects, including unknown storage fields', async () => {
    storage.getJSON.mockReturnValue([
      {
        url: 'https://stored.example',
        title: 'Stored',
        favicon: 'https://stored.example/icon.png',
        lastVisited: '2026-07-30T00:00:00Z',
        wire_only: 'preserved',
      },
      { url: 42, lastVisited: 'invalid' },
    ]);
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      hydrateBrowserWorkspaceWorker,
      initBrowserWorkspace('ws-1'),
    ).toPromise();

    expect(storage.getJSON.mock.calls).toEqual([['browser-recent-ws-1']]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'browser/hydrateBrowserState',
        payload: [
          'ws-1',
          [
            {
              url: 'https://stored.example',
              title: 'Stored',
              favicon: 'https://stored.example/icon.png',
              lastVisited: '2026-07-30T00:00:00Z',
              wire_only: 'preserved',
            },
          ],
        ],
      },
    ]);
  });

  it('caps stored recent URLs at twenty', async () => {
    storage.getJSON.mockReturnValue(Array.from({ length: 21 }, (_, index) => recent(index)));
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      hydrateBrowserWorkspaceWorker,
      initBrowserWorkspace('ws-1'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'browser/hydrateBrowserState',
        payload: [
          'ws-1',
          [
            recent(0),
            recent(1),
            recent(2),
            recent(3),
            recent(4),
            recent(5),
            recent(6),
            recent(7),
            recent(8),
            recent(9),
            recent(10),
            recent(11),
            recent(12),
            recent(13),
            recent(14),
            recent(15),
            recent(16),
            recent(17),
            recent(18),
            recent(19),
          ],
        ],
      },
    ]);
  });

  it('hydrates an empty list for missing, malformed, or failed storage', async () => {
    const dispatch = vi.fn();
    storage.getJSON.mockReturnValueOnce({ recentUrls: [recent(1)] }).mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    await runSaga(
      { dispatch, getState: state },
      hydrateBrowserWorkspaceWorker,
      initBrowserWorkspace('ws-1'),
    ).toPromise();
    await runSaga(
      { dispatch, getState: state },
      hydrateBrowserWorkspaceWorker,
      initBrowserWorkspace('ws-2'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'browser/hydrateBrowserState', payload: ['ws-1', []] },
      { type: 'browser/hydrateBrowserState', payload: ['ws-2', []] },
    ]);
  });

  it('persists the exact post-reducer list after all four mutation triggers', async () => {
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, browserPersistenceSaga);
    channel.put(
      addRecentUrl('ws-1', 'https://new.example', 'New', undefined, '2026-07-30T00:00:00Z'),
    );
    channel.put(updateUrlMetadata('ws-1', persisted[0].url, 'Updated', undefined));
    channel.put(removeRecentUrl('ws-1', persisted[0].url));
    channel.put(clearRecentUrls('ws-1'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      ['browser-recent-ws-1', persisted],
      ['browser-recent-ws-1', persisted],
      ['browser-recent-ws-1', persisted],
      ['browser-recent-ws-1', persisted],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not read, hydrate, or persist an empty ID or absent workspace state', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: state }, browserPersistenceSaga);
    channel.put(initBrowserWorkspace(''));
    channel.put(clearRecentUrls(''));
    channel.put(updateUrlMetadata('ws-missing', 'https://missing.example', 'Missing', undefined));
    channel.put(removeRecentUrl('ws-missing', 'https://missing.example'));
    channel.put(clearRecentUrls('ws-missing'));
    await settle();

    expect(storage.getJSON.mock.calls).toEqual([]);
    expect(storage.setJSON.mock.calls).toEqual([]);
    expect(dispatch.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('swallows write failures and continues processing later mutations', async () => {
    storage.setJSON.mockImplementation(() => {
      throw new Error('quota');
    });
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, browserPersistenceSaga);
    channel.put(clearRecentUrls('ws-1'));
    channel.put(removeRecentUrl('ws-1', persisted[0].url));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      ['browser-recent-ws-1', persisted],
      ['browser-recent-ws-1', persisted],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels in-flight hydration and persistence watcher work', async () => {
    let resolveRead!: (value: unknown) => void;
    storage.getJSON.mockReturnValue(new Promise((done) => (resolveRead = done)));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: state }, browserPersistenceSaga);
    channel.put(initBrowserWorkspace('ws-1'));
    await settle();
    task.cancel();
    resolveRead([recent(1)]);
    await task.toPromise();

    expect(dispatch.mock.calls).toEqual([]);
    expect(task.isCancelled()).toEqual(true);

    let resolveWrite!: () => void;
    storage.setJSON.mockReturnValue(new Promise<void>((done) => (resolveWrite = done)));
    const persistenceChannel = stdChannel();
    const persistenceTask = runSaga(
      { channel: persistenceChannel, dispatch: vi.fn(), getState: state },
      browserPersistenceSaga,
    );
    persistenceChannel.put(clearRecentUrls('ws-1'));
    await settle();
    persistenceTask.cancel();
    resolveWrite();
    await persistenceTask.toPromise();

    expect(storage.setJSON.mock.calls).toEqual([['browser-recent-ws-1', persisted]]);
    expect(persistenceTask.isCancelled()).toEqual(true);
  });
});

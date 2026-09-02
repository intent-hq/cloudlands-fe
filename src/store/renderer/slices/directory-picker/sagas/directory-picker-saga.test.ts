import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: mocks.info, warn: mocks.warn }),
}));

import { m } from '$shared/paraglide/messages.js';
import {
  createDirectoryRequested,
  directoryPickerReducer,
  initialState,
  loadDirectoryRequested,
  navigateToPathRequested,
  type DirectoryPickerListing,
  type DirectoryPickerState,
} from '../directory-picker-slice';
import { directoryPickerSaga } from './directory-picker-saga';

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Pre-7.0 daemon shape (no `favorites`); the FE keeps working against it.
function listing(path: string): DirectoryPickerListing {
  return {
    path,
    parent: '/Users/me',
    home: '/Users/me',
    entries: [
      { name: 'src', path: `${path}/src`, isDirectory: true, isGitRepo: false },
      { name: 'repo', path: `${path}/repo`, isDirectory: true, isGitRepo: true },
    ],
  };
}

// PROTOCOL.md §5.14 (v7.0) shape: `favorites` is always present, existence
// checked on the daemon host, `home` always leading.
function listingWithFavorites(path: string): DirectoryPickerListing {
  return {
    ...listing(path),
    favorites: [
      { id: 'home', path: '/Users/me' },
      { id: 'desktop', path: '/Users/me/Desktop' },
      { id: 'downloads', path: '/Users/me/Downloads' },
    ],
  };
}

function harness(seed: Partial<DirectoryPickerState> = {}) {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  let state: DirectoryPickerState = { ...initialState, ...seed };
  // Mirrors production: every action (trigger or saga-dispatched) runs through
  // the real reducer before the saga sees it, so `getState` stays faithful.
  const send = (action: Parameters<typeof directoryPickerReducer>[1]) => {
    state = directoryPickerReducer(state, action);
    channel.put(action);
  };
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        dispatched.push(action);
        send(action);
      },
      getState: () => ({ directoryPicker: state }),
    },
    directoryPickerSaga,
  );
  return { send, dispatched, task, state: () => state };
}

describe('directoryPickerSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends the exact path request and forwards the full listing', async () => {
    const response = listing('/Users/me/code');
    mocks.request.mockResolvedValue(response);
    const { send, dispatched, task } = harness();

    send(loadDirectoryRequested('/Users/me/code'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/Users/me/code' }]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/Users/me/code', response],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('stores the wire favorites field intact in slice state', async () => {
    const response = listingWithFavorites('/Users/me/code');
    mocks.request.mockResolvedValue(response);
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested('/Users/me/code'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/Users/me/code' }]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/Users/me/code', response],
      },
    ]);
    expect(state().listing).toEqual(response);
    expect(state().listing?.favorites).toEqual([
      { id: 'home', path: '/Users/me' },
      { id: 'desktop', path: '/Users/me/Desktop' },
      { id: 'downloads', path: '/Users/me/Downloads' },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses an empty params object for daemon-host home', async () => {
    const response = listing('/Users/me');
    mocks.request.mockResolvedValue(response);
    const { send, dispatched, task } = harness();

    send(loadDirectoryRequested());
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', {}]]);
    expect(dispatched).toEqual([
      { type: 'directoryPicker/listingLoaded', payload: [null, response] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches the exact terminal error for a failed home load', async () => {
    mocks.request.mockRejectedValue('transport unavailable');
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested());
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', {}]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingFailed',
        payload: [null, 'transport unavailable'],
      },
    ]);
    expect(state().loading).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('falls back once from a missing initial path and applies the home listing', async () => {
    const home = listing('/Users/me');
    mocks.request
      .mockRejectedValueOnce(new Error('No such file or directory (os error 2)'))
      .mockResolvedValueOnce(home);
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested('/gone'));
    await settle();
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/gone' }],
      ['host.listDirectory', {}],
    ]);
    // The fallback echoes the recorded requestedPath so the reducer accepts
    // the home listing instead of discarding it as stale.
    expect(dispatched).toEqual([
      { type: 'directoryPicker/listingLoaded', payload: ['/gone', home] },
    ]);
    expect(state().listing).toEqual(home);
    expect(state().loading).toBe(false);
    expect(state().error).toBeNull();
    task.cancel();
    await task.toPromise();
  });

  it('reports a terminal error when the home fallback itself fails', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('No such file or directory (os error 2)'))
      .mockRejectedValueOnce(new Error('transport unavailable'));
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested('/gone'));
    await settle();
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingFailed',
        payload: ['/gone', 'transport unavailable'],
      },
    ]);
    expect(state().loading).toBe(false);
    expect(state().error).toBe('transport unavailable');
    task.cancel();
    await task.toPromise();
  });

  it('keeps the listing and shows an inline hint when navigating to a missing path', async () => {
    const current = listing('/Users/me');
    mocks.request.mockRejectedValue(new Error('No such file or directory (os error 2)'));
    const { send, dispatched, state, task } = harness({
      listing: current,
      requestedPath: '/Users/me',
    });

    send(loadDirectoryRequested('/Users/me/ghost'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/Users/me/ghost' }]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/pathNavigationFailed',
        payload: ['/Users/me/ghost', m.onboarding_dirPicker_pathNotFound_error()],
      },
    ]);
    expect(state().loading).toBe(false);
    expect(state().pathError).toBe(m.onboarding_dirPicker_pathNotFound_error());
    expect(state().listing).toEqual(current);
    task.cancel();
    await task.toPromise();
  });

  it('keeps the listing and shows a non-missing navigation error verbatim', async () => {
    const current = listing('/Users/me');
    mocks.request.mockRejectedValue(new Error('Permission denied (os error 13)'));
    const { send, dispatched, state, task } = harness({
      listing: current,
      requestedPath: '/Users/me',
    });

    send(loadDirectoryRequested('/Users/me/vault'));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/pathNavigationFailed',
        payload: ['/Users/me/vault', 'Permission denied (os error 13)'],
      },
    ]);
    expect(state().loading).toBe(false);
    expect(state().pathError).toBe('Permission denied (os error 13)');
    expect(state().listing).toEqual(current);
    task.cancel();
    await task.toPromise();
  });

  // Regression: intent-hq/monorepo#2650 — under takeLeading, a click landing
  // while a load was in flight was dropped, yet the reducer recorded its
  // requestedPath; the first response then failed the stale-guard and the
  // spinner stayed stuck until the next click.
  it('terminates the spinner when a click lands while a load is in flight', async () => {
    const first = deferred<DirectoryPickerListing>();
    const second = deferred<DirectoryPickerListing>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested('/a'));
    await settle();
    send(loadDirectoryRequested('/b'));
    await settle();

    // The mid-flight click must get its own request, not be dropped.
    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/a' }],
      ['host.listDirectory', { path: '/b' }],
    ]);

    first.resolve(listing('/a'));
    await settle();
    second.resolve(listing('/b'));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/b', listing('/b')],
      },
    ]);
    expect(state().loading).toBe(false);
    expect(state().listing).toEqual(listing('/b'));
    task.cancel();
    await task.toPromise();
  });

  // Regression: intent-hq/monorepo#2650 — same window during the initial-load
  // home fallback: an intervening click made the echoed home listing stale
  // again, and no task existed for the new path.
  it('terminates the spinner when a click lands during the initial home fallback', async () => {
    const fallback = deferred<DirectoryPickerListing>();
    const next = deferred<DirectoryPickerListing>();
    mocks.request
      .mockRejectedValueOnce(new Error('No such file or directory (os error 2)'))
      .mockReturnValueOnce(fallback.promise)
      .mockReturnValueOnce(next.promise);
    const { send, dispatched, state, task } = harness();

    send(loadDirectoryRequested('/gone'));
    await settle();
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/gone' }],
      ['host.listDirectory', {}],
    ]);

    send(loadDirectoryRequested('/b'));
    await settle();
    fallback.resolve(listing('/Users/me'));
    await settle();
    next.resolve(listing('/b'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/gone' }],
      ['host.listDirectory', {}],
      ['host.listDirectory', { path: '/b' }],
    ]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/b', listing('/b')],
      },
    ]);
    expect(state().loading).toBe(false);
    expect(state().listing).toEqual(listing('/b'));
    task.cancel();
    await task.toPromise();
  });

  it('uses global latest arbitration for loads, restarting a re-clicked path', async () => {
    const first = deferred<DirectoryPickerListing>();
    const second = deferred<DirectoryPickerListing>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { send, dispatched, task } = harness();

    send(loadDirectoryRequested('/one'));
    await settle();
    send(loadDirectoryRequested('/one'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/one' }],
      ['host.listDirectory', { path: '/one' }],
    ]);
    // The superseded task was cancelled, so its response dispatches nothing.
    first.resolve(listing('/one'));
    await settle();
    expect(dispatched).toEqual([]);

    second.resolve(listing('/one'));
    await settle();
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/one', listing('/one')],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('routes typed-path success through the exact path request', async () => {
    const response = listing('/Users/me/typed');
    mocks.request.mockResolvedValue(response);
    const { send, dispatched, task } = harness();

    send(navigateToPathRequested('/Users/me/typed'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/Users/me/typed' }]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/Users/me/typed', response],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('maps a missing typed path to the localized inline error', async () => {
    mocks.request.mockRejectedValue(new Error('ENOENT: missing'));
    const { send, dispatched, task } = harness();

    send(navigateToPathRequested('/missing'));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/pathNavigationFailed',
        payload: ['/missing', m.onboarding_dirPicker_pathNotFound_error()],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a non-missing typed-path error verbatim', async () => {
    mocks.request.mockRejectedValue(new Error('Permission denied (os error 13)'));
    const { send, dispatched, task } = harness();

    send(navigateToPathRequested('/forbidden'));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/pathNavigationFailed',
        payload: ['/forbidden', 'Permission denied (os error 13)'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses global latest navigation semantics, including an empty latest payload', async () => {
    const stale = deferred<DirectoryPickerListing>();
    const latest = listing('/latest');
    mocks.request.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(latest);
    const { send, dispatched, task } = harness();

    send(navigateToPathRequested('/stale'));
    await settle();
    send(navigateToPathRequested('/latest'));
    send(navigateToPathRequested(''));
    await settle();
    stale.resolve(listing('/stale'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/stale' }],
      ['host.listDirectory', { path: '/latest' }],
    ]);
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('creates a directory with the exact wire request before loading it', async () => {
    const created = listing('/Users/me/new-folder');
    mocks.request.mockResolvedValueOnce(undefined).mockResolvedValueOnce(created);
    const { send, dispatched, task } = harness();

    send(createDirectoryRequested('/Users/me/new-folder'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.createDirectory', { path: '/Users/me/new-folder' }],
      ['host.listDirectory', { path: '/Users/me/new-folder' }],
    ]);
    expect(dispatched).toEqual([
      { type: 'directoryPicker/loadRequested', payload: ['/Users/me/new-folder'] },
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/Users/me/new-folder', created],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a create failure as createDirectoryFailed without reloading', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Permission denied (os error 13)'));
    const { send, dispatched, task } = harness();

    send(createDirectoryRequested('/forbidden/new-folder'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.createDirectory', { path: '/forbidden/new-folder' }],
    ]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/createDirectoryFailed',
        payload: ['/forbidden/new-folder', 'Permission denied (os error 13)'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cleans up pending work without dispatching on root cancellation', async () => {
    const pending = deferred<DirectoryPickerListing>();
    mocks.request.mockReturnValue(pending.promise);
    const { send, dispatched, task } = harness();

    send(loadDirectoryRequested('/pending'));
    await settle();
    task.cancel();
    await task.toPromise();
    pending.resolve(listing('/pending'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/pending' }]]);
    expect(dispatched).toEqual([]);
  });
});

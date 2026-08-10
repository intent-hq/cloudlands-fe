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
  loadDirectoryRequested,
  navigateToPathRequested,
  type DirectoryPickerListing,
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

function harness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
      },
    },
    directoryPickerSaga,
  );
  return { channel, dispatched, task };
}

describe('directoryPickerSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends the exact path request and forwards the full listing', async () => {
    const response = listing('/Users/me/code');
    mocks.request.mockResolvedValue(response);
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested('/Users/me/code'));
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

  it('uses an empty params object for daemon-host home', async () => {
    const response = listing('/Users/me');
    mocks.request.mockResolvedValue(response);
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested());
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
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested());
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', {}]]);
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingFailed',
        payload: [null, 'transport unavailable'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('falls back once from a missing initial path to daemon-host home', async () => {
    const home = listing('/Users/me');
    mocks.request
      .mockRejectedValueOnce(new Error('No such file or directory (os error 2)'))
      .mockResolvedValueOnce(home);
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested('/gone'));
    await settle();
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/gone' }],
      ['host.listDirectory', {}],
    ]);
    expect(dispatched).toEqual([{ type: 'directoryPicker/listingLoaded', payload: [null, home] }]);
    task.cancel();
    await task.toPromise();
  });

  it('uses global leading arbitration for loads across different paths', async () => {
    const first = deferred<DirectoryPickerListing>();
    const second = deferred<DirectoryPickerListing>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested('/one'));
    channel.put(loadDirectoryRequested('/one'));
    channel.put(loadDirectoryRequested('/two'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/one' }]]);
    first.resolve(listing('/one'));
    await settle();
    expect(dispatched).toEqual([
      {
        type: 'directoryPicker/listingLoaded',
        payload: ['/one', listing('/one')],
      },
    ]);

    channel.put(loadDirectoryRequested('/two'));
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['host.listDirectory', { path: '/one' }],
      ['host.listDirectory', { path: '/two' }],
    ]);
    second.resolve(listing('/two'));
    await settle();
    expect(dispatched.at(-1)).toEqual({
      type: 'directoryPicker/listingLoaded',
      payload: ['/two', listing('/two')],
    });
    task.cancel();
    await task.toPromise();
  });

  it('routes typed-path success through the exact path request', async () => {
    const response = listing('/Users/me/typed');
    mocks.request.mockResolvedValue(response);
    const { channel, dispatched, task } = harness();

    channel.put(navigateToPathRequested('/Users/me/typed'));
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
    const { channel, dispatched, task } = harness();

    channel.put(navigateToPathRequested('/missing'));
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
    const { channel, dispatched, task } = harness();

    channel.put(navigateToPathRequested('/forbidden'));
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
    const { channel, dispatched, task } = harness();

    channel.put(navigateToPathRequested('/stale'));
    await settle();
    channel.put(navigateToPathRequested('/latest'));
    channel.put(navigateToPathRequested(''));
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
    const { channel, dispatched, task } = harness();

    channel.put(createDirectoryRequested('/Users/me/new-folder'));
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

  it('cleans up pending work without dispatching on root cancellation', async () => {
    const pending = deferred<DirectoryPickerListing>();
    mocks.request.mockReturnValue(pending.promise);
    const { channel, dispatched, task } = harness();

    channel.put(loadDirectoryRequested('/pending'));
    await settle();
    task.cancel();
    await task.toPromise();
    pending.resolve(listing('/pending'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([['host.listDirectory', { path: '/pending' }]]);
    expect(dispatched).toEqual([]);
  });
});

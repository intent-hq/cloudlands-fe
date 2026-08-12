import { CANCEL, runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ updateContext: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { updateContext: mocks.updateContext } },
}));

import { addContextItem, updateContextItem } from '../context-slice';
import { contextSaga } from './context-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('contextSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('persists the exact post-reducer snapshot and isolates failures by workspace', async () => {
    mocks.updateContext
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const channel = stdChannel();
    const first = { id: 'first', kind: 'text' as const, content: 'one', position: 0 };
    const second = { id: 'second', kind: 'text' as const, content: 'two', position: 0 };
    const state = {
      byWorkspaceId: {
        'ws-1': { items: createCollection('id', [first]), loading: false, error: null },
        'ws-2': { items: createCollection('id', [second]), loading: false, error: null },
      },
    };
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ context: state }) },
      contextSaga,
    );

    channel.put(addContextItem('ws-1', first));
    channel.put(addContextItem('ws-2', second));
    await settle();

    expect(mocks.updateContext).toHaveBeenNthCalledWith(1, 'ws-1', [first]);
    expect(mocks.updateContext).toHaveBeenNthCalledWith(2, 'ws-2', [second]);
    task.cancel();
    await task.toPromise();
  });

  it('keeps writes for different workspaces concurrent', async () => {
    let resolveFirst!: () => void;
    const cancelFirst = vi.fn();
    const firstWrite = new Promise<void>((resolve) => (resolveFirst = resolve));
    Object.assign(firstWrite, { [CANCEL]: cancelFirst });
    mocks.updateContext.mockReturnValueOnce(firstWrite).mockResolvedValue(undefined);
    const channel = stdChannel();
    const first = { id: 'first', kind: 'text' as const, content: 'one', position: 0 };
    const second = { id: 'second', kind: 'text' as const, content: 'two', position: 0 };
    const state = {
      byWorkspaceId: {
        'ws-1': { items: createCollection('id', [first]), loading: false, error: null },
        'ws-2': { items: createCollection('id', [second]), loading: false, error: null },
      },
    };
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ context: state }) },
      contextSaga,
    );

    channel.put(addContextItem('ws-1', first));
    await settle();
    channel.put(addContextItem('ws-2', second));
    await settle();

    expect(cancelFirst).not.toHaveBeenCalled();
    expect(mocks.updateContext.mock.calls).toEqual([
      ['ws-1', [first]],
      ['ws-2', [second]],
    ]);
    resolveFirst();
    await settle();
    expect(cancelFirst).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('cancels only stale same-workspace writes and starts each latest snapshot', async () => {
    let resolveFirst!: () => void;
    const cancelFirst = vi.fn();
    const firstWrite = new Promise<void>((resolve) => (resolveFirst = resolve));
    Object.assign(firstWrite, { [CANCEL]: cancelFirst });
    mocks.updateContext.mockReturnValueOnce(firstWrite).mockResolvedValue(undefined);
    const channel = stdChannel();
    const first = { id: 'first', kind: 'text' as const, content: 'one', position: 0 };
    const latest = { ...first, content: 'latest' };
    let items = [first];
    const task = runSaga(
      {
        channel,
        dispatch: vi.fn(),
        getState: () => ({
          context: {
            byWorkspaceId: {
              'ws-1': { items: createCollection('id', items), loading: false, error: null },
            },
          },
        }),
      },
      contextSaga,
    );

    channel.put(addContextItem('ws-1', first));
    await settle();
    items = [latest];
    channel.put(updateContextItem('ws-1', 'first', { content: 'middle' }));
    channel.put(updateContextItem('ws-1', 'first', { content: 'latest' }));
    await settle();
    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(mocks.updateContext).toHaveBeenCalledTimes(3);

    resolveFirst();
    await settle();
    expect(mocks.updateContext.mock.calls).toEqual([
      ['ws-1', [first]],
      ['ws-1', [latest]],
      ['ws-1', [latest]],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels all in-flight workspace persistence with the root', async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    const firstWrite = new Promise<void>((resolve) => (resolveFirst = resolve));
    const secondWrite = new Promise<void>((resolve) => (resolveSecond = resolve));
    Object.assign(firstWrite, { [CANCEL]: cancelFirst });
    Object.assign(secondWrite, { [CANCEL]: cancelSecond });
    mocks.updateContext.mockReturnValueOnce(firstWrite).mockReturnValueOnce(secondWrite);
    const channel = stdChannel();
    const item = { id: 'first', kind: 'text' as const, content: 'one', position: 0 };
    const state = {
      byWorkspaceId: {
        'ws-1': { items: createCollection('id', [item]), loading: false, error: null },
        'ws-2': { items: createCollection('id', [item]), loading: false, error: null },
      },
    };
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => ({ context: state }) },
      contextSaga,
    );
    channel.put(addContextItem('ws-1', item));
    channel.put(addContextItem('ws-2', item));
    await settle();
    task.cancel();
    await task.toPromise();
    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(cancelSecond).toHaveBeenCalledTimes(1);
    resolveFirst();
    resolveSecond();
    await settle();
    expect(mocks.updateContext).toHaveBeenCalledTimes(2);
  });
});

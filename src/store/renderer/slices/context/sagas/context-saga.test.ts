import { CANCEL, runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ updateContext: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { updateContext: mocks.updateContext } },
}));

import { addContextItem, updateContextItem } from '../context-slice';
import { contextSaga } from './context-saga';
import {
  beginLifecycleMetadataMutation,
  contextRecoveryKey,
  runLifecycleMetadataRead,
} from '$features/events/lifecycle-metadata-recovery';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';

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
    const first = {
      id: 'first',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'one',
    };
    const second = {
      id: 'second',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'two',
    };
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
    const first = {
      id: 'first',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'one',
    };
    const second = {
      id: 'second',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'two',
    };
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
    const first = {
      id: 'first',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'one',
    };
    const latest = { ...first, title: 'latest' };
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
    channel.put(updateContextItem('ws-1', 'first', { title: 'middle' }));
    channel.put(updateContextItem('ws-1', 'first', { title: 'latest' }));
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
    const item = {
      id: 'first',
      type: 'note' as const,
      provider: 'internal' as const,
      noteId: 'note',
      createdAt: '',
      updatedAt: '',
      title: 'one',
    };
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

describe('context recovery mutation barriers', () => {
  afterEach(() => vi.clearAllMocks());
  it.each(['success', 'failure', 'cancel'] as const)(
    'drains actual persistence after %s without blocking future reads',
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const physical = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      mocks.updateContext.mockReturnValue(physical);
      const item = {
        id: 'leased',
        type: 'note' as const,
        provider: 'internal' as const,
        noteId: 'note',
        createdAt: '',
        updatedAt: '',
        title: 'new',
      };
      const action = addContextItem('lease-context-' + outcome, item);
      const ws = action.payload[0];
      const lease = beginLifecycleMetadataMutation(action)!;
      const channel = stdChannel();
      const task = runSaga(
        {
          channel,
          dispatch: vi.fn(),
          getState: () => ({
            context: {
              byWorkspaceId: {
                [ws]: { items: createCollection('id', [item]), loading: false, error: null },
              },
            },
          }),
        },
        contextSaga,
      );
      const registry = new RendererEventRecovery();
      const read = vi.fn(async () => []);
      try {
        channel.put(action);
        await settle();
        const pending = runLifecycleMetadataRead(
          contextRecoveryKey(ws),
          registry.capture(contextRecoveryKey(ws)),
          read,
        );
        if (outcome === 'cancel') task.cancel();
        await settle();
        expect(read).not.toHaveBeenCalled();
        if (outcome === 'failure') reject(new Error('offline'));
        else resolve();
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
        await pending;
        expect(mocks.updateContext).toHaveBeenCalledWith(ws, [item]);
      } finally {
        resolve();
        lease.finish();
        task.cancel();
        await task.toPromise();
        registry.dispose();
      }
    },
  );
});

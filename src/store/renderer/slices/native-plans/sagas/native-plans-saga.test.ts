/**
 * @vitest-environment jsdom
 *
 * The saga must consume the IPC transport seam (`window.electronAPI.on`
 * against 'acp:plan-updated' / 'acp:plan-cleared'), NOT the renderer's own
 * planManager module instance — that singleton is only updated in the main
 * process, so a same-process subscription would never fire in production
 * (monorepo#3249 review finding).
 */
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyNativePlanCleared, applyNativePlanUpdated } from '../native-plans-slice';
import { nativePlansSaga, toNativePlanEntries } from './native-plans-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type IpcListener = (payload: unknown) => void;

describe('nativePlansSaga', () => {
  let listeners: Map<string, IpcListener>;
  let offById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listeners = new Map();
    offById = vi.fn((channel: string) => {
      listeners.delete(channel);
    });
    vi.stubGlobal('electronAPI', {
      on: vi.fn((channel: string, handler: IpcListener) => {
        listeners.set(channel, handler);
        return `listener-${channel}`;
      }),
      offById,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function startSaga() {
    const dispatched: unknown[] = [];
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: (action: unknown) => dispatched.push(action), getState: () => ({}) },
      nativePlansSaga,
    );
    return { dispatched, task };
  }

  it('subscribes to the IPC bridge channels, not a local planManager', async () => {
    const { task } = startSaga();
    await settle();

    expect(listeners.has('acp:plan-updated')).toBe(true);
    expect(listeners.has('acp:plan-cleared')).toBe(true);

    task.cancel();
  });

  it('mirrors bridged plan-updated and plan-cleared events into slice actions', async () => {
    const { dispatched, task } = startSaga();
    await settle();

    listeners.get('acp:plan-updated')!({
      sessionId: 'acp-session-1',
      entries: [
        { id: 'e1', title: 'Analyze', status: 'in_progress', icon: '⏳', progress: 50 },
        { id: 'e2', title: 'Implement', status: 'pending', color: 'blue' },
      ],
    });
    await settle();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(
      applyNativePlanUpdated('acp-session-1', [
        { id: 'e1', title: 'Analyze', status: 'in_progress' },
        { id: 'e2', title: 'Implement', status: 'pending' },
      ]),
    );

    listeners.get('acp:plan-cleared')!({ sessionId: 'acp-session-1' });
    await settle();

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual(applyNativePlanCleared('acp-session-1'));

    task.cancel();
  });

  it('unsubscribes from both channels on cancellation', async () => {
    const { dispatched, task } = startSaga();
    await settle();
    task.cancel();
    await settle();

    expect(offById).toHaveBeenCalledWith('acp:plan-updated', 'listener-acp:plan-updated');
    expect(offById).toHaveBeenCalledWith('acp:plan-cleared', 'listener-acp:plan-cleared');
    expect(dispatched).toHaveLength(0);
  });
});

describe('toNativePlanEntries', () => {
  it('keeps canonical fields, recurses children, and drops presentation extras', () => {
    const entries = toNativePlanEntries([
      {
        id: 'root',
        title: 'Root',
        status: 'in_progress',
        icon: '⏳',
        color: 'blue',
        progress: 50,
        startedAt: 123,
        children: [
          { id: 'child', title: 'Child', status: 'completed', icon: '✅', color: 'green' },
        ],
      },
    ]);

    expect(entries).toEqual([
      {
        id: 'root',
        title: 'Root',
        status: 'in_progress',
        children: [{ id: 'child', title: 'Child', status: 'completed' }],
      },
    ]);
  });
});

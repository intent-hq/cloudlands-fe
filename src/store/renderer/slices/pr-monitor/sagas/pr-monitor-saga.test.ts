import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ subscribePrMonitors: vi.fn() }));
vi.mock('$features/pr-monitor/pr-monitor-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$features/pr-monitor/pr-monitor-service')>();
  return { ...actual, subscribePrMonitors: mocks.subscribePrMonitors };
});

import {
  cancelPrMonitor,
  flushPrMonitor,
  type PrMonitorRow,
} from '$features/pr-monitor/pr-monitor-service';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  initialState,
  prMonitorReducer,
} from '../pr-monitor-slice';
import {
  clearActiveWorkspace,
  initialState as workspaceInitialState,
  setActiveWorkspaceId,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import { cancelPrMonitorWorker, flushPrMonitorWorker, prMonitorSaga } from './pr-monitor-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createHarness(activeWorkspaceId: string | null = null) {
  const initialWorkspaceState = activeWorkspaceId
    ? workspaceReducer(workspaceInitialState, setActiveWorkspaceId(activeWorkspaceId))
    : workspaceInitialState;
  let state = { workspace: initialWorkspaceState, prMonitor: initialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof prMonitorReducer>[1]) => {
    state = {
      workspace: workspaceReducer(state.workspace, action),
      prMonitor: prMonitorReducer(state.prMonitor, action),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    prMonitorSaga,
  );
  return { dispatch, getState: reduxStore.getState, listeners, task };
}

async function advanceReconciliation() {
  await vi.advanceTimersByTimeAsync(100);
  await settle();
}

describe('prMonitorSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.subscribePrMonitors.mockImplementation(() => ({ dispose: vi.fn() }));
  });

  afterEach(() => vi.useRealTimers());

  it('forwards flush and cancel triggers with their exact wire arguments', () => {
    const flushIterator = flushPrMonitorWorker(flushPrMonitorRequested('ws-1', 'mon-1'));
    const flushEffect = flushIterator.next().value as {
      type: string;
      payload: { fn: unknown; args: unknown[] };
    };
    expect(flushEffect.type).toBe('CALL');
    expect(flushEffect.payload.fn).toBe(flushPrMonitor);
    expect(flushEffect.payload.args).toEqual(['ws-1', 'mon-1', undefined]);

    // Check-and-flush trigger (§5.42) forwards the check flag to the service.
    const checkIterator = flushPrMonitorWorker(flushPrMonitorRequested('ws-1', 'mon-1', true));
    const checkEffect = checkIterator.next().value as {
      type: string;
      payload: { fn: unknown; args: unknown[] };
    };
    expect(checkEffect.type).toBe('CALL');
    expect(checkEffect.payload.fn).toBe(flushPrMonitor);
    expect(checkEffect.payload.args).toEqual(['ws-1', 'mon-1', true]);

    const cancelIterator = cancelPrMonitorWorker(cancelPrMonitorRequested('ws-1', 'mon-1'));
    const cancelEffect = cancelIterator.next().value as {
      type: string;
      payload: { fn: unknown; args: unknown[] };
    };
    expect(cancelEffect.type).toBe('CALL');
    expect(cancelEffect.payload.fn).toBe(cancelPrMonitor);
    expect(cancelEffect.payload.args).toEqual(['ws-1', 'mon-1']);
  });

  it('registers selector reconciliation and command watchers', () => {
    const iterator = prMonitorSaga();
    const effect = iterator.next().value as {
      type: string;
      payload: Generator[];
    };
    const childEffects = effect.payload.map(
      (child) =>
        child.next().value as {
          type: string;
          payload: { fn: { name: string }; args: unknown[] };
        },
    );

    expect(effect.type).toBe('ALL');
    expect(effect.payload).toHaveLength(3);
    expect(childEffects.map((child) => child.type)).toEqual(Array(3).fill('CALL'));
    expect(childEffects.map((child) => child.payload.fn.name)).toEqual([
      'watchActiveWorkspace',
      'watchFlush',
      'watchCancel',
    ]);
    expect(childEffects[0].payload.args[0]).toBeInstanceOf(Map);
  });

  it('subscribes to the initial active workspace after 100 ms and forwards rows', async () => {
    const harness = createHarness('ws-A');
    await settle();

    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.subscribePrMonitors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.subscribePrMonitors).toHaveBeenCalledTimes(1);
    expect(mocks.subscribePrMonitors.mock.calls[0][0]).toBe('ws-A');

    const monitor = { monitorId: 'mon-1', workspaceId: 'ws-A', state: 'active' } as PrMonitorRow;
    const emit = mocks.subscribePrMonitors.mock.calls[0][1] as (rows: PrMonitorRow[]) => void;
    emit([monitor]);
    await settle();
    expect(harness.getState().prMonitor.byWorkspaceId['ws-A'].monitors.map['mon-1']).toBe(monitor);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('switches A to B exactly once after the trailing delay', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribePrMonitors.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(setActiveWorkspaceId('ws-B'));
    await settle();
    await vi.advanceTimersByTimeAsync(99);
    expect(disposeA).not.toHaveBeenCalled();
    expect(mocks.subscribePrMonitors).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(mocks.subscribePrMonitors.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      'ws-A',
      'ws-B',
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('avoids churn when an A to B to A burst restores the live workspace', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribePrMonitors.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(setActiveWorkspaceId('ws-B'));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    harness.dispatch(setActiveWorkspaceId('ws-A'));
    await settle();
    await advanceReconciliation();

    expect(mocks.subscribePrMonitors).toHaveBeenCalledTimes(1);
    expect(disposeA).not.toHaveBeenCalled();
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('disposes the live subscription when the active workspace is cleared', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribePrMonitors.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;

    harness.dispatch(clearActiveWorkspace());
    await settle();
    await advanceReconciliation();

    expect(disposeA).toHaveBeenCalledOnce();
    expect(mocks.subscribePrMonitors).toHaveBeenCalledTimes(1);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('ignores unrelated Redux updates while the active workspace is unchanged', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();
    const disposeA = mocks.subscribePrMonitors.mock.results[0].value.dispose as ReturnType<
      typeof vi.fn
    >;
    const monitor = { monitorId: 'mon-1', workspaceId: 'ws-A', state: 'active' } as PrMonitorRow;
    const emit = mocks.subscribePrMonitors.mock.calls[0][1] as (rows: PrMonitorRow[]) => void;

    emit([monitor]);
    await settle();
    await advanceReconciliation();

    expect(harness.getState().prMonitor.byWorkspaceId['ws-A'].monitors.map['mon-1']).toBe(monitor);
    expect(mocks.subscribePrMonitors).toHaveBeenCalledTimes(1);
    expect(disposeA).not.toHaveBeenCalled();
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('closes the live subscription and selector listener on root cancellation', async () => {
    const harness = createHarness('ws-A');
    await settle();
    await advanceReconciliation();

    harness.task.cancel();
    await harness.task.toPromise();

    expect(mocks.subscribePrMonitors.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(harness.listeners.size).toBe(0);
  });
});

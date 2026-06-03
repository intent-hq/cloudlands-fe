/**
 * Lifecycle integration tests for agent-subscription-ui saga.
 *
 * Uses runSaga with the real reducer to verify eventChannel lifecycle,
 * cross-workspace isolation, auto-dismiss timing, and cleanup.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  runSaga,
  stdChannel,
} from 'redux-saga';
import * as sagaEffects from 'redux-saga/effects';

// Must mock typed-redux-saga before importing saga modules
vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield {
      '@@redux-saga/IO': true,
      combinator: false,
      type: 'CANCEL',
      payload: task,
    };
  },
}));

const {
  listenSyncMock,
  invokeMock,
  extractEventDataMock,
  selectTrackedAgentIdsMock,
  selectWaitingStateMock,
} = vi.hoisted(() => ({
  listenSyncMock: vi.fn((_event: string, _handler: (payload: any) => void) => vi.fn()),
  invokeMock: vi.fn(),
  extractEventDataMock: vi.fn((event: any, fieldName?: string) => {
    const payload = event?.payload ?? event;
    if (fieldName) return payload?.[fieldName];
    return payload;
  }),
  selectTrackedAgentIdsMock: vi.fn(() => []),
  selectWaitingStateMock: vi.fn((state: any, workspaceId: string, agentId: string) => {
    const key = `${workspaceId}:${agentId}`;
    return state?.agentSubscriptionUI?.entries?.[key]?.waitingState ?? 'idle';
  }),
}));

vi.mock('$lib/electron-bridge', () => ({
  listenSync: listenSyncMock,
  invoke: invokeMock,
  extractEventData: extractEventDataMock,
}));

vi.mock('../agent-subscription-ui-selectors', () => ({
  selectTrackedAgentIds: {
    select: (...args: any[]) => selectTrackedAgentIdsMock(...args),
    effect: function* (...args: any[]) {
      return yield sagaEffects.select(selectTrackedAgentIdsMock, ...args);
    },
  },
  selectWaitingState: {
    select: (...args: any[]) => selectWaitingStateMock(...args),
    effect: function* (...args: any[]) {
      return yield sagaEffects.select(selectWaitingStateMock, ...args);
    },
  },
}));

vi.mock('../../workspace-lifecycle/workspace-lifecycle-slice', () => ({
  workspaceMounted: Object.assign((wsId: string) => ({
    type: 'workspace-lifecycle/workspaceMounted',
    payload: [wsId],
  }), { type: 'workspace-lifecycle/workspaceMounted', toString: () => 'workspace-lifecycle/workspaceMounted' }),
  workspaceUnmounted: Object.assign((wsId: string) => ({
    type: 'workspace-lifecycle/workspaceUnmounted',
    payload: [wsId],
  }), { type: 'workspace-lifecycle/workspaceUnmounted', toString: () => 'workspace-lifecycle/workspaceUnmounted' }),
}));

import { agentSubscriptionUISaga } from './agent-subscription-ui-saga';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  agentSubscriptionUIReducer,
  initialState,
  makeKey,
} from '../agent-subscription-ui-slice';
import type { AgentSubscriptionUIState } from '../agent-subscription-ui-types';

const WS_A = 'ws-a';
const WS_B = 'ws-b';
const AGENT_1 = 'agent-1';

// Helpers

function makeSnapshotResponse(agentId: string, hasSubs = true) {
  return {
    success: true,
    data: hasSubs
      ? [{ id: 's1', agentId, eventTypes: ['file:*'], actorIds: [], createdAt: '', description: '' }]
      : [],
    delegationGroups: [],
    agentStatuses: {},
  };
}

/** Capture the IPC listeners registered by listenSync so we can emit events */
function captureListeners() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  listenSyncMock.mockImplementation((eventName: string, handler: (payload: any) => void) => {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    const wrappedHandler = (payload: any) => handler({ payload });
    listeners.get(eventName)!.add(wrappedHandler);
    const cleanup = vi.fn(() => { listeners.get(eventName)?.delete(wrappedHandler); });
    return cleanup;
  });
  return listeners;
}

function emitIpcEvent(
  listeners: Map<string, Set<(payload: any) => void>>,
  eventName: string,
  payload: Record<string, any>,
) {
  const handlers = listeners.get(eventName);
  if (handlers) {
    for (const h of handlers) h(payload);
  }
}

function createSagaRunner() {
  let state: AgentSubscriptionUIState = { ...initialState };
  const dispatched: any[] = [];
  const channel = stdChannel();

  const dispatch = (action: any) => {
    dispatched.push(action);
    state = agentSubscriptionUIReducer(state, action);
    channel.put(action);
  };

  const getState = () => ({ agentSubscriptionUI: state });

  return {
    run: (saga: any, ...args: any[]) =>
      runSaga({ channel, dispatch, getState }, saga, ...args),
    dispatched,
    getState,
    channel,
    get state() { return state; },
  };
}

const _flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('agent-subscription-ui lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: invoke returns a snapshot with subs
    invokeMock.mockResolvedValue(makeSnapshotResponse(AGENT_1));
    // electronAPI must exist for channel creation
    (globalThis as any).window = { electronAPI: {} };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
  });

  // -----------------------------------------------------------------------
  // 1. Root saga creates exactly one long-lived listener per event
  // -----------------------------------------------------------------------
  it('root saga registers long-lived IPC listeners once and workspaceMounted does not duplicate them', async () => {
    const _listeners = captureListeners();
    const runner = createSagaRunner();

    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    expect(listenSyncMock.mock.calls.length).toBe(11);

    runner.channel.put(workspaceMounted(WS_A));
    runner.channel.put(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    expect(listenSyncMock.mock.calls.length).toBe(11);

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 2. workspaceUnmounted prunes local caches but does not close listeners
  // -----------------------------------------------------------------------
  it('workspaceUnmounted leaves long-lived listeners active', async () => {
    const listeners = captureListeners();
    const runner = createSagaRunner();

    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    // Emit an event → should trigger snapshot fetch
    emitIpcEvent(listeners, 'agent:subscribed', {
      workspaceId: WS_A,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const stateAfterEvent = { ...runner.state };
    expect(Object.keys(stateAfterEvent.entries).length).toBeGreaterThan(0);

    // Unmount prunes local generation/cache state only.
    runner.channel.put(workspaceUnmounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    // Emit another event — listener should still route by event workspaceId.
    emitIpcEvent(listeners, 'agent:subscribed', {
      workspaceId: WS_A,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const dispatchedAfterUnmount = runner.dispatched.filter(
      (a) => a.type === 'agentSubscriptionUI/setSubscriptionSnapshot',
    );
    expect(dispatchedAfterUnmount.length).toBe(2);

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 3. Workspace mount actions do not create duplicate watchers
  // -----------------------------------------------------------------------
  it('workspace mount actions do not affect root listener registration', async () => {
    const _listeners = captureListeners();

    const runner = createSagaRunner();

    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    expect(listenSyncMock.mock.calls.length).toBe(11);

    runner.channel.put(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    expect(listenSyncMock.mock.calls.length).toBe(11);

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 4. Concurrent workspaces receive only their own events
  // -----------------------------------------------------------------------
  it('concurrent workspaces receive only their own events', async () => {
    const listeners = captureListeners();
    invokeMock.mockImplementation((_channel: string, args: any) => {
      return Promise.resolve(makeSnapshotResponse(args.agentId));
    });

    const runner = createSagaRunner();
    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    // Mount two workspaces
    runner.channel.put(workspaceMounted(WS_A));
    runner.channel.put(workspaceMounted(WS_B));
    await vi.advanceTimersByTimeAsync(0);

    // Emit event for WS_A only
    emitIpcEvent(listeners, 'agent:subscribed', {
      workspaceId: WS_A,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    // WS_A should have an entry, WS_B should not
    const keyA = makeKey(WS_A, AGENT_1);
    const keyB = makeKey(WS_B, AGENT_1);
    expect(runner.state.entries[keyA]).toBeDefined();
    expect(runner.state.entries[keyB]).toBeUndefined();

    // Emit event for WS_B
    emitIpcEvent(listeners, 'agent:subscribed', {
      workspaceId: WS_B,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.state.entries[keyB]).toBeDefined();

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 5. Auto-dismiss does not clear a newer wake event during 5s delay
  // -----------------------------------------------------------------------
  it('auto-dismiss does not clear a newer wake event that arrived during 5s delay', async () => {
    const listeners = captureListeners();
    const runner = createSagaRunner();
    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    runner.channel.put(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    // First wake event
    emitIpcEvent(listeners, 'agent:woken-by-subscription', {
      workspaceId: WS_A,
      agentId: AGENT_1,
      eventCount: 1,
      eventTypes: ['file:*'],
    });
    await vi.advanceTimersByTimeAsync(0);

    const key = makeKey(WS_A, AGENT_1);
    expect(runner.state.entries[key]?.waitingState).toBe('woken');
    const _firstTimestamp = runner.state.entries[key]?.wokenUpInfo?.timestamp;

    // Advance 3 seconds (before auto-dismiss of first)
    await vi.advanceTimersByTimeAsync(3000);

    // Second wake event arrives during the 5s window
    emitIpcEvent(listeners, 'agent:woken-by-subscription', {
      workspaceId: WS_A,
      agentId: AGENT_1,
      eventCount: 2,
      eventTypes: ['git:*'],
    });
    await vi.advanceTimersByTimeAsync(0);

    // First auto-dismiss fires at t=5s (2s from now)
    await vi.advanceTimersByTimeAsync(2000);

    // The buffered, non-blocking IPC helper should process the second wake
    // event before the stale first auto-dismiss can clear the newer indicator.
    const stateAfterFirstClear = runner.state.entries[key];
    expect(stateAfterFirstClear?.wokenUpInfo?.eventCount).toBe(2);
    expect(stateAfterFirstClear?.waitingState).toBe('woken');

    // The newer event's own auto-dismiss eventually clears the indicator.
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.state.entries[key]?.wokenUpInfo).toBeNull();

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 6. Snapshot arrives after resetSubscriptionUI → documents race behavior
  // -----------------------------------------------------------------------
  it('snapshot after resetSubscriptionUI documents the race condition', async () => {
    const listeners = captureListeners();

    // All invoke calls resolve immediately
    invokeMock.mockResolvedValue(makeSnapshotResponse(AGENT_1));

    const runner = createSagaRunner();
    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    runner.channel.put(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    // Trigger event → snapshot populates state
    emitIpcEvent(listeners, 'agent:subscribed', {
      workspaceId: WS_A,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const key = makeKey(WS_A, AGENT_1);
    expect(runner.state.entries[key]).toBeDefined();
    expect(runner.state.entries[key]?.waitingState).toBe('waiting');

    // agent:stopped fires → fetchAndDispatchSnapshot runs first (sets snapshot),
    // then resetSubscriptionUI clears the entry
    emitIpcEvent(listeners, 'agent:stopped', {
      workspaceId: WS_A,
      agentId: AGENT_1,
    });
    await vi.advanceTimersByTimeAsync(0);

    // After the stopped handler completes: the entry is reset
    // (resetSubscriptionUI runs after fetchAndDispatchSnapshot in the handler)
    expect(runner.state.entries[key]).toBeUndefined();

    // Verify the sequence: setSubscriptionSnapshot was dispatched (from the stopped
    // handler's fetchAndDispatchSnapshot), then resetSubscriptionUI cleared it
    const snapshotActions = runner.dispatched.filter(
      (a) => a.type === 'agentSubscriptionUI/setSubscriptionSnapshot',
    );
    const resetActions = runner.dispatched.filter(
      (a) => a.type === 'agentSubscriptionUI/resetSubscriptionUI',
    );
    expect(snapshotActions.length).toBeGreaterThanOrEqual(2); // initial + stopped handler
    expect(resetActions.length).toBe(1);

    // Verify reset came after the last snapshot
    const lastSnapshotIdx = runner.dispatched.lastIndexOf(snapshotActions[snapshotActions.length - 1]);
    const resetIdx = runner.dispatched.indexOf(resetActions[0]);
    expect(resetIdx).toBeGreaterThan(lastSnapshotIdx);

    rootTask.cancel();
    await rootTask.toPromise();
  });

  // -----------------------------------------------------------------------
  // 7. Listener cleanup on saga cancellation (no dangling IPC listeners)
  // -----------------------------------------------------------------------
  it('listener cleanup on saga cancellation — no dangling IPC listeners', async () => {
    const listeners = captureListeners();
    const cleanupFns: ReturnType<typeof vi.fn>[] = [];

    // Track cleanup functions returned by listenSync
    listenSyncMock.mockImplementation((_eventName: string, handler: (payload: any) => void) => {
      if (!listeners.has(_eventName)) listeners.set(_eventName, new Set());
      const wrappedHandler = (payload: any) => handler({ payload });
      listeners.get(_eventName)!.add(wrappedHandler);
      const cleanup = vi.fn(() => { listeners.get(_eventName)?.delete(wrappedHandler); });
      cleanupFns.push(cleanup);
      return cleanup;
    });

    const runner = createSagaRunner();
    const rootTask = runner.run(agentSubscriptionUISaga);
    await vi.advanceTimersByTimeAsync(0);

    runner.channel.put(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(0);

    // Should have registered 11 listeners
    expect(cleanupFns.length).toBe(11);

    // Cancel the root saga (simulates app teardown)
    rootTask.cancel();
    await rootTask.toPromise();

    // All cleanup functions should have been called
    for (const cleanup of cleanupFns) {
      expect(cleanup).toHaveBeenCalled();
    }

    // All listener sets should be empty
    for (const [, handlerSet] of listeners) {
      expect(handlerSet.size).toBe(0);
    }
  });
});

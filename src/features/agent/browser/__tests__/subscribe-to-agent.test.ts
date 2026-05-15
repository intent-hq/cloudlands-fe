/**
 * Tests for subscribeToAgent / notifyAgentSubscribers in src/features/agent/browser/index.ts.
 * Verifies the shared Redux subscription reacts to agent-session changes and
 * ignores unrelated store updates.
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
  combineReducers,
  legacy_createStore as createStore,
  type Store,
} from 'redux';
import {
  agentSessionReducer,
  upsertSession,
  renameSession,
} from '$lib/store/slices/agent-session/agent-session-slice';
import {
  initReduxDispatchBridge,
  initReduxStoreBridge,
} from '$lib/store/redux-dispatch-bridge';
import {
  subscribeToAgent,
  notifyAgentSubscribers,
} from '$features/agent/browser';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';

type UnrelatedState = { counter: number };
type UnrelatedAction = { type: 'unrelated/bump' };
const unrelatedReducer = (state: UnrelatedState = { counter: 0 }, action: UnrelatedAction) =>
  action.type === 'unrelated/bump' ? { counter: state.counter + 1 } : state;

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  const now = new Date('2026-04-21T00:00:00.000Z').toISOString();
  return {
    id: 'agent-1',
    backendSessionId: null,
    workspaceId: 'ws-1',
    name: 'Initial Name',
    status: AgentStatus.Active,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AgentSession;
}

function makeStore() {
  const rootReducer = combineReducers({
    agentSessions: agentSessionReducer,
    unrelated: unrelatedReducer,
  });
  const store = createStore(rootReducer as any);
  initReduxDispatchBridge(store.dispatch.bind(store));
  initReduxStoreBridge(store as any);
  return store as Store;
}

describe('subscribeToAgent (Redux-reactive)', () => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes the callback synchronously with the current value on subscribe', () => {
    const agent = makeAgent();
    store.dispatch(upsertSession(agent));

    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.name).toBe('Initial Name');
    unsubscribe();
  });

  it('invokes undefined when there is no session for the agent id', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('missing-agent', cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeUndefined();
    unsubscribe();
  });

  it('fires callbacks when the agent-session reference changes via rename', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    store.dispatch(renameSession('agent-1', 'Renamed'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.name).toBe('Renamed');
    unsubscribe();
  });

  it('does not fire callbacks when an unrelated slice changes', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    store.dispatch({ type: 'unrelated/bump' } as UnrelatedAction);
    store.dispatch({ type: 'unrelated/bump' } as UnrelatedAction);

    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not re-fire when the same session reference is seen twice', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    // Rename to the same name → reducer short-circuits and returns state unchanged.
    store.dispatch(renameSession('agent-1', 'Initial Name'));

    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('unsubscribe removes the callback so later store changes do not fire it', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    unsubscribe();
    store.dispatch(renameSession('agent-1', 'Renamed'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('tears down the shared Redux subscription when the last subscriber leaves and re-creates it on the next subscribe', () => {
    const subscribeSpy = vi.spyOn(store, 'subscribe');
    subscribeSpy.mockClear();

    const cb1 = vi.fn();
    const unsub1 = subscribeToAgent('agent-a', cb1);
    const cb2 = vi.fn();
    const unsub2 = subscribeToAgent('agent-b', cb2);

    // Only one shared subscription should be registered despite two callbacks.
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();

    // After the last subscriber leaves, a new subscribe should re-register
    // the shared subscription on the underlying store.
    subscribeSpy.mockClear();
    const cb3 = vi.fn();
    const unsub3 = subscribeToAgent('agent-c', cb3);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    unsub3();
  });

  it('notifyAgentSubscribers forces a callback dispatch for the given agent id', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    notifyAgentSubscribers('agent-1');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.id).toBe('agent-1');
    unsubscribe();
  });

  it('notifyAgentSubscribers keeps the shared listener quiet for the same snapshot', () => {
    store.dispatch(upsertSession(makeAgent()));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    notifyAgentSubscribers('agent-1');
    expect(cb).toHaveBeenCalledTimes(1);
    cb.mockClear();

    // An unrelated store update should not cause the shared listener to
    // re-dispatch the same session it already delivered via notify.
    store.dispatch({ type: 'unrelated/bump' } as UnrelatedAction);
    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });
});

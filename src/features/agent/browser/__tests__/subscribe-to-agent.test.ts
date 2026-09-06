/**
 * Tests for subscribeToAgent / notifyAgentSubscribers in src/features/agent/browser/index.ts.
 * Verifies the shared Redux subscription reacts to agent-session changes and
 * ignores unrelated store updates.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '@augmentcode/themis/svelte-store';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import {
  agentSessionReducer,
  bulkUpsertSessions,
  renameSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';

const { storeRef, stateListeners, selectorSubscribeSpy, capturedSelectorFuncs } = vi.hoisted(
  () => ({
    storeRef: { current: null as any },
    stateListeners: new Set<() => void>(),
    selectorSubscribeSpy: vi.fn(),
    capturedSelectorFuncs: [] as Array<(state: any, ...args: any[]) => any>,
  }),
);

const synchronousStateMiddleware = (() => (next: any) => (action: any) => {
  const result = next(action);
  for (const listener of stateListeners) listener();
  return result;
}) as any;

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      selectorSubscribeSpy();
      listener(getter());
      const update = () => listener(getter());
      stateListeners.add(update);
      return () => stateListeners.delete(update);
    },
  });
  const mockStore = {
    dispatch: (action: unknown) => storeRef.current?.dispatch(action as never),
    get state() {
      return storeRef.current?.state;
    },
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => {
          capturedSelectorFuncs.push(selectorFunc);
          return readable(() => selectorFunc(mockStore.state, ...args));
        },
        {
          select: selectorFunc,
          effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
          withStore:
            (storeSource: { state?: unknown }) =>
            (...args: any[]) =>
              readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
        },
      ),
  };

  return createStoreMockModule(mockStore);
});

import { subscribeToAgent, notifyAgentSubscribers } from '$features/agent/browser';
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
  const store = new Store(
    {
      agentSessions: agentSessionReducer,
      unrelated: unrelatedReducer,
    },
    synchronousStateMiddleware,
  );
  store.init();
  storeRef.current = store;
  return store;
}

describe('subscribeToAgent (Redux-reactive)', () => {
  let store: Store<any, any>;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    stateListeners.clear();
    selectorSubscribeSpy.mockClear();
    capturedSelectorFuncs.length = 0;
    store.dispose();
    storeRef.current = null;
    vi.restoreAllMocks();
  });

  it('backs the shared subscription with a path-accessing selector, not an identity selector', () => {
    // Regression: Themis cached selectors invalidate by tracked accessed
    // paths. An identity selector ((state) => state) records no accessed
    // paths, so the readable never re-emitted after its initial value and
    // subscribers (e.g. the tab menu's Copy conversation gate) stayed stale.
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);

    expect(capturedSelectorFuncs.length).toBeGreaterThan(0);
    // Find the shared-subscription selector by its result rather than by
    // capture index, so unrelated readable creations added later cannot make
    // this test silently assert against the wrong selector.
    const storeState = store.state;
    const sharedSelector = capturedSelectorFuncs.find(
      (fn) => fn(storeState) === storeState.agentSessions,
    );
    expect(sharedSelector).toBeDefined();
    if (!sharedSelector) return;
    const accessedPaths: string[] = [];
    const trackingState = new Proxy(
      { agentSessions: { byAgentId: {} } } as Record<string, unknown>,
      {
        get(target, prop) {
          if (typeof prop === 'string') accessedPaths.push(prop);
          return Reflect.get(target, prop);
        },
      },
    );
    const result = sharedSelector(trackingState);

    expect(result).not.toBe(trackingState);
    expect(accessedPaths).toContain('agentSessions');
    unsubscribe();
  });

  it('invokes the callback synchronously with the current value on subscribe', () => {
    const agent = makeAgent();
    store.dispatch(bulkUpsertSessions([agent], { preserveExplicitRuntimeFlags: false }));

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

  it('re-emits the session when it becomes available after an initial undefined', () => {
    // Regression: the tab menu's Copy conversation gate subscribes before the
    // session lands in the store (initial undefined) and must re-enable once a
    // later bulkUpsertSessions makes the agent available.
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeUndefined();

    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]?.name).toBe('Initial Name');
    unsubscribe();
  });

  it('fires callbacks when the agent-session reference changes via rename', () => {
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    store.dispatch(renameSession('agent-1', 'Renamed'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.name).toBe('Renamed');
    unsubscribe();
  });

  it('does not fire callbacks when an unrelated slice changes', () => {
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    store.dispatch({ type: 'unrelated/bump' } as UnrelatedAction);
    store.dispatch({ type: 'unrelated/bump' } as UnrelatedAction);

    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not re-fire when the same session reference is seen twice', () => {
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    // Rename to the same name → reducer short-circuits and returns state unchanged.
    store.dispatch(renameSession('agent-1', 'Initial Name'));

    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('unsubscribe removes the callback so later store changes do not fire it', () => {
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    unsubscribe();
    store.dispatch(renameSession('agent-1', 'Renamed'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('tears down the shared Redux subscription when the last subscriber leaves and re-creates it on the next subscribe', () => {
    const subscribeSpy = selectorSubscribeSpy;
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
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
    const cb = vi.fn();
    const unsubscribe = subscribeToAgent('agent-1', cb);
    cb.mockClear();

    notifyAgentSubscribers('agent-1');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.id).toBe('agent-1');
    unsubscribe();
  });

  it('notifyAgentSubscribers keeps the shared listener quiet for the same snapshot', () => {
    store.dispatch(bulkUpsertSessions([makeAgent()], { preserveExplicitRuntimeFlags: false }));
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

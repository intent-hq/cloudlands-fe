import { readFileSync } from 'node:fs';

import type { AgentMessage, AgentSession } from '$shared/types';
import type { Readable } from 'svelte/store';
import { readable, writable } from 'svelte/store';
import type { Store } from '@augmentcode/themis/svelte-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initAppStore, store as appStore } from './store';
import {
  _resetRendererStoreBridge,
  clearRendererStoreBridge,
  getRendererStore,
  initRendererStoreBridge,
} from './renderer-store-bridge';
import { store as configuredStore } from './configured-store';
import { reducers } from './reducer';
import type { GenericAction } from '@augmentcode/themis/types';
import type { StoreState } from './types';
import { addMessage, bulkUpsertSessions } from './slices/agent-session/agent-session-slice';
import { selectAgentMessages } from './slices/agent-session/agent-session-selectors';

function createFakeStoreRuntime(initialState = {} as StoreState) {
  let state = initialState;
  const subscribers = new Set<(value: StoreState) => void>();
  const readableState: Readable<StoreState> = readable(state, (set) => {
    subscribers.add(set);
    set(state);
    return () => subscribers.delete(set);
  });
  const dispose = vi.fn();
  const dispatch = vi.fn((action: GenericAction) => {
    state = { ...state };
    subscribers.forEach((set) => set(state));
    return action;
  });

  const runtime = {
    init: vi.fn(() => dispose),
    getReadableState: vi.fn(() => readableState),
    dispatch,
    get state() {
      return state;
    },
    dispose,
  };

  return runtime;
}

function createAgentSession(id: string, messages: AgentMessage[]): AgentSession {
  return {
    id: id as AgentSession['id'],
    backendSessionId: null,
    workspaceId: 'workspace-1' as AgentSession['workspaceId'],
    name: id,
    status: 'idle' as AgentSession['status'],
    messages,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
}

function createMessage(id: string, text: string): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: '2026-08-10T00:00:00.000Z',
  };
}

beforeEach(() => {
  _resetRendererStoreBridge();
});

describe('configured app Store', () => {
  it('constructs the core Store without importing app sagas', () => {
    const source = readFileSync('src/store/renderer/configured-store.ts', 'utf8');

    expect(source).not.toContain('from "./sagas"');
    expect(source).toContain(
      'new RendererStore(reducers, middleware as unknown as StoreMiddleware[])',
    );
    expect(source).not.toContain('new Store(reducers, sagas');
    expect(appStore).toBe(configuredStore);
  });

  it('creates selectors directly from the configured Store', () => {
    const state = {} as StoreState;
    const selectStoreState = appStore.createSelector((state) => state);

    expect(selectStoreState.select(state)).toBe(state);
  });

  it('emits agent messages only for selected message or writable agent changes', async () => {
    const firstMessage = createMessage('message-a1', 'First agent message');
    const secondAgentMessage = createMessage('message-b1', 'Second agent message');
    const nextMessage = createMessage('message-a2', 'Updated first agent message');
    const dispose = appStore.init();
    appStore.dispatch(
      bulkUpsertSessions([
        createAgentSession('agent-a', [firstMessage]),
        createAgentSession('agent-b', [secondAgentMessage]),
      ]),
    );
    const selectedAgentId = writable('agent-a');
    const emissions: AgentMessage[][] = [];
    const unsubscribe = selectAgentMessages
      .withStore(appStore)(selectedAgentId)
      .subscribe((messages) => emissions.push(messages));

    try {
      expect(emissions.map((messages) => messages.map((message) => message.id))).toEqual([
        ['message-a1'],
      ]);

      appStore.dispatch({ type: 'test/unrelatedReduxChange' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(emissions).toHaveLength(1);

      appStore.dispatch(addMessage('agent-a', nextMessage));
      await vi.waitFor(() => expect(emissions).toHaveLength(2));
      expect(emissions[1].map((message) => message.id)).toEqual(['message-a1', 'message-a2']);

      selectedAgentId.set('agent-b');
      await vi.waitFor(() => expect(emissions).toHaveLength(3));
      expect(emissions[2].map((message) => message.id)).toEqual(['message-b1']);
    } finally {
      unsubscribe();
      dispose();
    }
  });

  it('keeps app reducers on the configured package Store', () => {
    const registeredReducers = appStore.getReducers();

    expect(reducers).not.toHaveProperty('storeUtility');
    expect(registeredReducers).not.toHaveProperty('storeUtility');
    expect(reducers).not.toHaveProperty('@internal_storeUtility');
    expect(reducers).not.toHaveProperty('@internal_sagaManager');
    expect(registeredReducers).toHaveProperty('@internal_storeUtility');
    expect(registeredReducers).toHaveProperty('@internal_sagaManager');

    for (const [name, reducer] of Object.entries(reducers)) {
      expect(registeredReducers[name]).toBe(reducer);
    }
  });
});

describe('app Store initialization', () => {
  it('initializes the configured Store and exposes dispatch/state through context', () => {
    const runtime = createFakeStoreRuntime();

    const context = initAppStore(runtime as unknown as Store<any, any>);

    expect(runtime.init).toHaveBeenCalledOnce();
    expect(context.store).toBe(runtime);
    expect('storeState' in context).toBe(false);

    const action = { type: 'test/action', payload: undefined };
    expect(context.store.dispatch(action)).toBe(action);
    expect(runtime.dispatch).toHaveBeenCalledWith(action);
    expect(context.store.state).toBe(runtime.state);
    expect(context.store.getReadableState()).toBe(runtime.getReadableState());
    expect(getRendererStore()).toBe(runtime);

    context.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(() => getRendererStore()).toThrow('Renderer store bridge not initialized');
  });

  it('can initialize again after root teardown clears the renderer store bridge', () => {
    const firstRuntime = createFakeStoreRuntime();
    const firstContext = initAppStore(firstRuntime as unknown as Store<any, any>);

    firstContext.dispose();

    const secondRuntime = createFakeStoreRuntime();
    const secondContext = initAppStore(secondRuntime as unknown as Store<any, any>);

    expect(getRendererStore()).toBe(secondRuntime);
    secondContext.dispose();
  });

  it('does not let an older disposer clear a newer renderer store bridge', () => {
    const oldRuntime = createFakeStoreRuntime();
    const newRuntime = createFakeStoreRuntime();

    initRendererStoreBridge(oldRuntime as unknown as Store<any, any>);
    initRendererStoreBridge(oldRuntime as unknown as Store<any, any>);
    expect(clearRendererStoreBridge(newRuntime as unknown as Store<any, any>)).toBe(false);
    expect(getRendererStore()).toBe(oldRuntime);
    expect(clearRendererStoreBridge(oldRuntime as unknown as Store<any, any>)).toBe(true);
    initRendererStoreBridge(newRuntime as unknown as Store<any, any>);

    expect(getRendererStore()).toBe(newRuntime);
  });
});

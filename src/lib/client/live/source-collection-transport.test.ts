import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { take } from 'typed-redux-saga';
import type { BackendRuntime } from './backend-transport-runtime';
import type { BackendNotification } from './backend-transport-types';
import type { createSettingsClientRuntime } from './backend-settings-client';

type Transport = Pick<
  BackendRuntime,
  | 'backendRequest'
  | 'backendSubscribe'
  | 'backendUnsubscribe'
  | 'onBackendNotification'
  | 'onBackendReconnected'
>;
type Request = (...args: Parameters<Transport['backendRequest']>) => Promise<unknown>;
type Subscribe = (...args: Parameters<Transport['backendSubscribe']>) => Promise<unknown>;
type ListenerRegistry = {
  notifications: Set<Parameters<Transport['onBackendNotification']>[0]>;
  reconnects: Set<() => void>;
  onNotification: ReturnType<typeof vi.fn<Transport['onBackendNotification']>>;
  onReconnect: ReturnType<typeof vi.fn<Transport['onBackendReconnected']>>;
  notify: (notification: BackendNotification) => void;
  reconnect: () => void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function transportFixture() {
  const capabilities: Partial<Transport> = {};
  const reads: (keyof Transport)[] = [];
  const unavailable = new Error('Capability used before installation');
  const listenerRegistries: ListenerRegistry[] = [];
  function read<K extends keyof Transport>(key: K): Transport[K] {
    reads.push(key);
    const capability = capabilities[key];
    if (capability === undefined) {
      Error.captureStackTrace(unavailable, read);
      throw unavailable;
    }
    return capability;
  }
  vi.doMock('./backend-transport', () => ({
    get backendRequest() {
      return read('backendRequest');
    },
    get backendSubscribe() {
      return read('backendSubscribe');
    },
    get backendUnsubscribe() {
      return read('backendUnsubscribe');
    },
    get onBackendNotification() {
      return read('onBackendNotification');
    },
    get onBackendReconnected() {
      return read('onBackendReconnected');
    },
  }));
  // Scripted wire values cross only the declared generic transport boundary.
  function request(implementation: Request) {
    capabilities.backendRequest = function <T>(
      this: unknown,
      ...args: Parameters<Transport['backendRequest']>
    ): Promise<T> {
      return Reflect.apply(implementation, this, args) as Promise<T>;
    };
  }
  function subscribe(implementation: Subscribe) {
    capabilities.backendSubscribe = function <T>(
      this: unknown,
      ...args: Parameters<Transport['backendSubscribe']>
    ): Promise<T> {
      return Reflect.apply(implementation, this, args) as Promise<T>;
    };
  }
  function listeners(): ListenerRegistry {
    const notifications = new Set<Parameters<Transport['onBackendNotification']>[0]>();
    const reconnects = new Set<() => void>();
    const onNotification = vi.fn<Transport['onBackendNotification']>((handler) => {
      notifications.add(handler);
      return vi.fn(() => {
        notifications.delete(handler);
      });
    });
    const onReconnect = vi.fn<Transport['onBackendReconnected']>((handler) => {
      reconnects.add(handler);
      return vi.fn(() => {
        reconnects.delete(handler);
      });
    });
    capabilities.onBackendNotification = onNotification;
    capabilities.onBackendReconnected = onReconnect;
    const registry = {
      notifications,
      reconnects,
      onNotification,
      onReconnect,
      notify: (notification: BackendNotification) => {
        for (const handler of notifications) handler(notification);
      },
      reconnect: () => {
        for (const handler of reconnects) handler();
      },
    };
    listenerRegistries.push(registry);
    return registry;
  }
  function assertListenersDisposed() {
    for (const registry of listenerRegistries) {
      expect(registry.notifications.size).toBe(0);
      expect(registry.reconnects.size).toBe(0);
      for (const port of [registry.onNotification, registry.onReconnect]) {
        for (const result of port.mock.results) {
          expect(result.type).toBe('return');
          expect(result.value).toHaveBeenCalledTimes(1);
        }
      }
    }
  }
  return {
    capabilities,
    reads,
    unavailable,
    request,
    subscribe,
    listeners,
    assertListenersDisposed,
  };
}

function settingsLifetime(transport: ReturnType<typeof transportFixture>) {
  const runtimes: ReturnType<typeof createSettingsClientRuntime>[] = [];
  // Observe the real owner without replacing any method, response, or lifecycle policy.
  vi.doMock('./backend-settings-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./backend-settings-client')>();
    return {
      ...actual,
      createSettingsClientRuntime: (
        ...args: Parameters<typeof actual.createSettingsClientRuntime>
      ) => {
        const runtime = actual.createSettingsClientRuntime(...args);
        runtimes.push(runtime);
        return runtime;
      },
    };
  });
  const dispose = () => {
    try {
      for (const runtime of runtimes.splice(0)) runtime.dispose();
    } finally {
      transport.assertListenersDisposed();
    }
  };
  cleanups.push(dispose);
  return dispose;
}

const cleanups: (() => void)[] = [];
beforeEach(() => vi.resetModules());
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.doUnmock('./backend-transport');
  vi.doUnmock('./backend-settings-client');
  vi.resetModules();
});

function setting(value: number, revision: number) {
  return {
    definition: {
      path: 'server.port',
      label: 'Server port',
      description: 'HTTP port',
      category: 'server',
      type: 'number',
      defaultValue: 3000,
    },
    value,
    revision,
    origin: 'file',
  };
}

function settingsNotification(subscriptionId = 'settings-sub'): BackendNotification {
  return {
    method: 'events.event',
    params: {
      subscriptionId,
      event: {
        id: 'setting-event',
        workspaceId: 'workspace-a',
        type: 'settings:changed',
        timestamp: '2026-10-12T00:00:00Z',
        actor: { type: 'system' },
        data: { changes: [{ path: 'server.port', value: 4100 }], revision: 7 },
      },
    },
  };
}

describe('source collection transport lookup', () => {
  it('imports all four source bindings before any capability is installed', async () => {
    const transport = transportFixture();
    const disposeSettings = settingsLifetime(transport);
    try {
      const { LiveSettingsClient } = await import('./live-settings-client');
      await import('$features/agent/agent.client');
      await import('$features/agent/agent-read-ownership');
      await import('$store/renderer/slices/workspace-events/sagas/daemon-events-saga');
      new LiveSettingsClient();
      new LiveSettingsClient();
      expect(transport.reads).toEqual([]);
    } finally {
      disposeSettings();
    }
  });

  it('looks up each model request at use while concurrent replies and optional scope stay distinct', async () => {
    const transport = transportFixture();
    const { agentClient } = await import('$features/agent/agent.client');
    const first = deferred<unknown>();
    const responseA = { success: true, modelId: 'model-a' };
    const responseB = { success: true, modelId: 'model-b' };
    const requestA = vi.fn<Request>(() => first.promise);
    const requestB = vi.fn<Request>(() => Promise.resolve(responseB));
    transport.request(requestA);
    const pending = agentClient.setModel('agent-a', 'model-a', 'workspace-a', 'provider-a');
    transport.request(requestB);
    expect(await agentClient.setModel('agent-b', 'model-b', 'workspace-b')).toEqual({
      ok: true,
      data: responseB,
    });
    first.resolve(responseA);
    const result = await pending;
    expect(result).toEqual({ ok: true, data: responseA });
    if (result.ok) expect(result.data).toBe(responseA);
    expect(requestA.mock.calls).toEqual([
      [
        'agent.setModel',
        {
          agentId: 'agent-a',
          modelId: 'model-a',
          workspaceId: 'workspace-a',
          providerId: 'provider-a',
        },
      ],
    ]);
    expect(requestB.mock.calls).toEqual([
      ['agent.setModel', { agentId: 'agent-b', modelId: 'model-b', workspaceId: 'workspace-b' }],
    ]);
    expect(requestA.mock.contexts).toEqual([undefined]);
    expect(requestB.mock.contexts).toEqual([undefined]);
    expect(transport.reads).toEqual(['backendRequest', 'backendRequest']);
  });

  it('retains model error folding for missing, synchronously throwing, and rejecting requests', async () => {
    const transport = transportFixture();
    const { agentClient } = await import('$features/agent/agent.client');
    const invoke = () => agentClient.setModel('agent-a', 'model-a', 'workspace-a');
    expect(await invoke()).toEqual({ ok: false, error: transport.unavailable.message });
    const failure = new Error('model change refused');
    const request = vi.fn<Request>(() => {
      throw failure;
    });
    transport.request(request);
    expect(await invoke()).toEqual({ ok: false, error: 'model change refused' });
    request.mockRejectedValue(failure);
    expect(await invoke()).toEqual({ ok: false, error: 'model change refused' });
    expect(request.mock.calls).toEqual(
      Array(2).fill([
        'agent.setModel',
        { agentId: 'agent-a', modelId: 'model-a', workspaceId: 'workspace-a' },
      ]),
    );
    expect(transport.reads).toEqual(['backendRequest', 'backendRequest', 'backendRequest']);
  });

  it('keeps the same pending settings Promise and invalidates cached reads through the real callback', async () => {
    const transport = transportFixture();
    const disposeSettings = settingsLifetime(transport);
    try {
      const { readSetting } = await import('./live-settings-client');
      const listeners = transport.listeners();
      const first = deferred<unknown>();
      const requestA = vi.fn<Request>(() => first.promise);
      transport.request(requestA);
      const pending = readSetting('server.port', 'workspace-a');
      expect(readSetting('server.port', 'workspace-a')).toBe(pending);
      expect(transport.reads).toEqual([
        'onBackendNotification',
        'onBackendReconnected',
        'backendRequest',
      ]);
      first.resolve(setting(4000, 6));
      expect(await pending).toMatchObject({ path: 'server.port', value: 4000, revision: 6 });
      expect(await readSetting('server.port', 'workspace-a')).toMatchObject({ value: 4000 });
      const requestB = vi.fn<Request>(() => Promise.resolve(setting(4100, 7)));
      transport.request(requestB);
      listeners.notify(settingsNotification());
      expect(await readSetting('server.port', 'workspace-a')).toMatchObject({
        value: 4100,
        revision: 7,
      });
      expect(requestA.mock.calls).toEqual([
        ['settings.get', { path: 'server.port', workspaceId: 'workspace-a' }],
      ]);
      expect(requestB.mock.calls).toEqual([
        ['settings.get', { path: 'server.port', workspaceId: 'workspace-a' }],
      ]);
      expect(requestA.mock.contexts).toEqual([undefined]);
      expect(requestB.mock.contexts).toEqual([undefined]);
      expect(listeners.onNotification).toHaveBeenCalledTimes(1);
      expect(listeners.onReconnect).toHaveBeenCalledTimes(1);
      expect(listeners.onNotification.mock.contexts).toEqual([undefined]);
      expect(listeners.onReconnect.mock.contexts).toEqual([undefined]);
    } finally {
      disposeSettings();
    }
  });

  it('coalesces invalidated pending reads into one trailing request using the current export', async () => {
    const transport = transportFixture();
    const disposeSettings = settingsLifetime(transport);
    try {
      const { readSetting } = await import('./live-settings-client');
      const listeners = transport.listeners();
      const first = deferred<unknown>();
      const requestA = vi.fn<Request>(() => first.promise);
      transport.request(requestA);
      const pending = readSetting('server.port', 'workspace-a');
      listeners.notify(settingsNotification());
      const requestB = vi.fn<Request>(() => Promise.resolve(setting(4100, 7)));
      transport.request(requestB);
      const trailing = readSetting('server.port', 'workspace-a');
      expect(readSetting('server.port', 'workspace-a')).toBe(trailing);
      expect(trailing).not.toBe(pending);
      expect(requestB).not.toHaveBeenCalled();
      first.resolve(setting(4000, 6));
      expect(await pending).toMatchObject({ value: 4000, revision: 6 });
      expect(await trailing).toMatchObject({ value: 4100, revision: 7 });
      expect(await readSetting('server.port', 'workspace-a')).toMatchObject({
        value: 4100,
        revision: 7,
      });
      expect(requestA.mock.calls).toEqual([
        ['settings.get', { path: 'server.port', workspaceId: 'workspace-a' }],
      ]);
      expect(requestB.mock.calls).toEqual([
        ['settings.get', { path: 'server.port', workspaceId: 'workspace-a' }],
      ]);
      expect(requestB.mock.contexts).toEqual([undefined]);
    } finally {
      disposeSettings();
    }
  });

  it('retires a pending settings read on reconnect without publishing its late reply', async () => {
    const transport = transportFixture();
    const disposeSettings = settingsLifetime(transport);
    try {
      const { readSetting } = await import('./live-settings-client');
      const listeners = transport.listeners();
      const first = deferred<unknown>();
      const requestA = vi.fn<Request>(() => first.promise);
      transport.request(requestA);
      const pending = readSetting('server.port');
      const rejected = expect(pending).rejects.toThrow('Settings connection retired');
      listeners.reconnect();
      const requestB = vi.fn<Request>(() => Promise.resolve(setting(4200, 8)));
      transport.request(requestB);
      expect(await readSetting('server.port')).toMatchObject({ value: 4200, revision: 8 });
      first.resolve(setting(4000, 6));
      await rejected;
      expect(await readSetting('server.port')).toMatchObject({ value: 4200, revision: 8 });
      expect(requestA.mock.calls).toEqual([['settings.get', { path: 'server.port' }]]);
      expect(requestB.mock.calls).toEqual([['settings.get', { path: 'server.port' }]]);
    } finally {
      disposeSettings();
    }
  });

  it('preserves the current rules request lifecycle and read error policy', async () => {
    const transport = transportFixture();
    const disposeSettings = settingsLifetime(transport);
    try {
      const { LiveSettingsClient } = await import('./live-settings-client');
      transport.listeners();
      const request = vi.fn<Request>(() =>
        Promise.resolve({ enabled: true, content: 'Rule text', updatedAt: 42 }),
      );
      transport.request(request);
      const client = new LiveSettingsClient();
      expect(await client.getUserRule('base-system-prompt')).toEqual({
        enabled: true,
        content: 'Rule text',
        updatedAt: 42,
      });
      expect(transport.reads).toEqual([
        'onBackendNotification',
        'onBackendReconnected',
        'backendRequest',
      ]);
      request.mockRejectedValue(new Error('rules unavailable'));
      expect(await client.getUserRule('base-system-prompt', 'workspace-a')).toBeNull();
      expect(request.mock.calls).toEqual([
        ['rules.get', { workspaceId: 'global', ruleType: 'base-system-prompt' }],
        ['rules.get', { workspaceId: 'workspace-a', ruleType: 'base-system-prompt' }],
      ]);
    } finally {
      disposeSettings();
    }
  });

  it('retires source ownership on reconnect and uses each original disposer after export replacement', async () => {
    const transport = transportFixture();
    const { agentReadOwnership, captureAgentMutationOwnership } =
      await import('$features/agent/agent-read-ownership');
    cleanups.push(() => agentReadOwnership.dispose());
    const first = transport.listeners();
    const owner = captureAgentMutationOwnership('agent-a', 'workspace-a');
    expect(owner.isCurrent('workspace-a')).toBe(true);
    expect(owner.isCurrent('workspace-b')).toBe(false);
    first.reconnect();
    expect(owner.isCurrent('workspace-a')).toBe(false);
    const next = captureAgentMutationOwnership('agent-a', 'workspace-a');
    expect(next.key).not.toBe(owner.key);
    expect(next.isCurrent('workspace-a')).toBe(true);
    const second = transport.listeners();
    const originalDisposer = first.onReconnect.mock.results[0]!.value;
    agentReadOwnership.dispose();
    expect(originalDisposer).toHaveBeenCalledTimes(1);
    expect(first.reconnects.size).toBe(0);
    expect(next.isCurrent('workspace-a')).toBe(false);
    expect(second.onReconnect).not.toHaveBeenCalled();
    const last = captureAgentMutationOwnership('agent-a', 'workspace-b');
    expect(last.isCurrent('workspace-b')).toBe(true);
    expect(second.reconnects.size).toBe(1);
    agentReadOwnership.dispose();
    agentReadOwnership.dispose();
    expect(second.onReconnect.mock.results[0]!.value).toHaveBeenCalledTimes(1);
    expect(second.reconnects.size).toBe(0);
    expect(first.onReconnect.mock.contexts).toEqual([undefined]);
    expect(second.onReconnect.mock.contexts).toEqual([undefined]);
    expect(transport.reads).toEqual(['onBackendReconnected', 'onBackendReconnected']);
  });

  it('propagates a registration failure at the first ownership claim', async () => {
    const transport = transportFixture();
    const { agentReadOwnership } = await import('$features/agent/agent-read-ownership');
    cleanups.push(() => agentReadOwnership.dispose());
    expect(() => agentReadOwnership.captureAgentMutationOwnership('agent-a')).toThrow(
      transport.unavailable,
    );
    expect(transport.reads).toEqual(['onBackendReconnected']);
  });

  it.each(['ready', 'pending'] as const)(
    'cleans source event listeners and scoped leases when cancelled with %s replies',
    async (mode) => {
      const transport = transportFixture();
      const { daemonEventsSaga } =
        await import('$store/renderer/slices/workspace-events/sagas/daemon-events-saga');
      const { store } = await import('$store/renderer/store');
      const { openWorkspaceTab } = await import('$store/renderer/slices/tab-state/tab-state-slice');
      const { daemonEventsSubscribed } =
        await import('$store/renderer/slices/workspace-events/workspace-events-slice');
      const { settingsChangesReceived } =
        await import('$store/renderer/slices/settings-events/settings-events-slice');
      cleanups.push(store.init());
      store.dispatch(openWorkspaceTab('workspace-a'));
      const listeners = transport.listeners();
      const firehose = deferred<unknown>();
      const scoped = deferred<unknown>();
      const bothRequested = deferred<void>();
      const ready = deferred<void>();
      const routed = deferred<ReturnType<typeof settingsChangesReceived>>();
      const stopped = deferred<void>();
      const removed = deferred<void>();
      const subscribe = vi.fn<Subscribe>((params) => {
        if (subscribe.mock.calls.length === 2) bothRequested.resolve();
        return params && typeof params === 'object' && 'workspaceId' in params
          ? scoped.promise
          : firehose.promise;
      });
      transport.subscribe(subscribe);
      cleanups.push(
        store.runSaga(function* observeReady() {
          yield* take(daemonEventsSubscribed);
          ready.resolve();
        }),
      );
      cleanups.push(
        store.runSaga(function* observeSettings() {
          routed.resolve(yield* take(settingsChangesReceived));
        }),
      );
      const stop = store.runSaga(function* sourceEvents() {
        try {
          yield* daemonEventsSaga();
        } finally {
          stopped.resolve();
        }
      });
      cleanups.push(stop);
      await bothRequested.promise;
      expect(subscribe.mock.calls).toEqual([
        [
          {
            eventTypes: [
              'agent:*',
              'hub:checkpoint',
              'note:*',
              'comment:*',
              'script:*',
              'terminal:exit',
              'settings:changed',
              'workspace:tokenUsage-changed',
              'workspace:context-changed',
              'workspace:activity-changed',
              'workspace:displayStatus-changed',
              'workspace:attention-changed',
              'workspace:waiting-changed',
              'workspace:updated',
              'workspace:created',
              'workspace:deleted',
              'workspace:delete-scheduled',
              'workspace:delete-cancelled',
              'task:*',
              'git:*',
              'changes:git-status',
              'changes:tracked',
              'changes:agent-locks',
              'line-attribution:updated',
              'pr:*',
              'mcp.servers:status-changed',
              'github:auth-changed',
              'sourceControl:auth-changed',
              'principal:identity-changed',
              'client:updated',
              'client:connected',
              'client:disconnected',
              'browser:tab-opened',
              'browser:tab-updated',
              'browser:tab-closed',
              'app:ui-navigate',
              'app:ui-highlight',
              'app:workspace-open',
              'presence:changed',
              'host:members-changed',
              'host:invites-changed',
              'host:execution-context-changed',
            ],
          },
        ],
        [{ eventTypes: ['file:*'], workspaceId: 'workspace-a', replaceGroup: 'file-events' }],
      ]);
      expect(subscribe.mock.contexts).toEqual([undefined, undefined]);
      expect(transport.reads).toEqual([
        'onBackendNotification',
        'onBackendReconnected',
        'backendSubscribe',
        'backendSubscribe',
      ]);
      if (mode === 'ready') {
        firehose.resolve({ subscriptionId: 'firehose-id' });
        scoped.resolve({ subscriptionId: 'scoped-id' });
        await ready.promise;
        listeners.notify(settingsNotification('firehose-id'));
        expect((await routed.promise).payload).toEqual([[{ path: 'server.port', value: 4100 }], 7]);
      }
      // Unsubscribe was unavailable at import and subscription; cancellation must look it up now.
      const unsubscribe = vi.fn<Transport['backendUnsubscribe']>(() => {
        if (unsubscribe.mock.calls.length === 2) removed.resolve();
        return Promise.resolve();
      });
      transport.capabilities.backendUnsubscribe = unsubscribe;
      const replacement = transport.listeners();
      stop();
      await stopped.promise;
      expect(listeners.onNotification.mock.results[0]!.value).toHaveBeenCalledTimes(1);
      expect(listeners.onReconnect.mock.results[0]!.value).toHaveBeenCalledTimes(1);
      expect(listeners.notifications.size).toBe(0);
      expect(listeners.reconnects.size).toBe(0);
      expect(replacement.onNotification).not.toHaveBeenCalled();
      expect(replacement.onReconnect).not.toHaveBeenCalled();
      if (mode === 'pending') {
        firehose.resolve({ subscriptionId: 'firehose-id' });
        scoped.resolve({ subscriptionId: 'scoped-id' });
      }
      await removed.promise;
      expect(unsubscribe.mock.calls).toHaveLength(2);
      expect(unsubscribe.mock.calls).toEqual(
        expect.arrayContaining([
          ['firehose-id', undefined],
          ['scoped-id', 'workspace-a'],
        ]),
      );
      expect(unsubscribe.mock.contexts).toEqual([undefined, undefined]);
      expect(store.state.workspaceEvents.subscriptionGeneration).toBe(mode === 'ready' ? 1 : 0);
    },
  );
});

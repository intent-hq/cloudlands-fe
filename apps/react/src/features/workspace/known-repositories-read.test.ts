// Actual React Store/backend/settings runtime; only the preload delivery boundary is controlled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { KnownRepo } from '$shared/types/known-repo';
import { store } from '../../store';
import { settingsRuntime } from '../settings/settings-client';
import { readKnownRepositories } from './known-repositories-read';
import {
  selectCanAdministerHost,
  selectPrincipalConnectionContext,
} from '../../store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { connectionsListReceived } from '../../../../../src/store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../src/store/renderer/slices/principal/principal-slice';

const cleanups: Array<() => Promise<void>> = [];
let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Known repository read cleanup failed');
});
function repo(path: string, lastUsedAt = '2026-01-01', githubUrl?: string): KnownRepo {
  return {
    path,
    name: path,
    addedAt: '2025-01-01',
    lastUsedAt,
    ...(githubUrl ? { githubUrl } : {}),
  };
}
function wireSetting(value: unknown) {
  return {
    value,
    definition: {
      path: 'repos.known',
      label: 'Known repositories',
      description: '',
      category: 'repos',
      type: 'object',
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function harness() {
  const priorApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const listeners = new Map<string, Map<string, (payload: unknown) => void>>();
  const registrations: Array<[string, string]> = [];
  const removals: Array<[string, string]> = [];
  const runtimeErrors: unknown[] = [];
  const recordError = (error: unknown) => {
    runtimeErrors.push(error);
  };
  const releases: Array<() => void> = [];
  type Outcome = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
  const pending: Array<{ outcome: Promise<Outcome>; expectedRejection: boolean }> = [];
  let dispose: (() => void) | undefined;
  let repoReply: unknown = { repos: [] };
  let settingReply: unknown = wireSetting([]);
  let listenerNumber = 0;
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
  request.mockImplementation(async (method) => {
    if (method === 'repo.list') return repoReply;
    if (method === 'settings.get') return settingReply;
    throw new Error(`Unexpected repository read method: ${method}`);
  });
  const api = {
    versions: { electron: 'test-preload' },
    invoke: vi.fn(async (channel: string, payload: unknown) => {
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST)
        throw new Error(`Unexpected preload channel: ${channel}`);
      const { method, params } = payload as { method: string; params?: unknown };
      return { ok: true, result: await request(method, params) };
    }),
    on(channel: string, callback: (payload: unknown) => void): string {
      const id = `known-repos-${++listenerNumber}`;
      let channelListeners = listeners.get(channel);
      if (!channelListeners) {
        channelListeners = new Map();
        listeners.set(channel, channelListeners);
      }
      channelListeners.set(id, callback);
      registrations.push([channel, id]);
      return id;
    },
    offById(channel: string, id: string): void {
      removals.push([channel, id]);
      listeners.get(channel)?.delete(id);
    },
  };
  // Register exhaustive cleanup before installing any bridge, Store or settings lifetime.
  cleanups.push(async () => {
    const failures: unknown[] = [];
    for (const release of releases) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const { outcome, expectedRejection } of pending) {
      const result = await outcome;
      if (result.status === 'rejected' && !expectedRejection) failures.push(result.reason);
    }
    for (const cleanup of [
      () => settingsRuntime.dispose(),
      () => {
        dispose?.();
        dispose = undefined;
      },
      () => store.traceStreams.runtimeError.offValue(recordError),
      () => expect(runtimeErrors).toEqual([]),
      () => expect(removals).toEqual(registrations),
      () => expect([...listeners.values()].flatMap((entries) => [...entries.keys()])).toEqual([]),
      () => {
        if (priorApi) Object.defineProperty(window, 'electronAPI', priorApi);
        else Reflect.deleteProperty(window, 'electronAPI');
      },
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Repository read resources did not close');
  });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api, writable: true });
  dispose = store.init();
  store.traceStreams.runtimeError.onValue(recordError);
  settingsRuntime.start();

  function track<T>(promise: Promise<T>, expectedRejection = false): Promise<T> {
    pending.push({
      expectedRejection,
      outcome: promise.then(
        (): Outcome => ({ status: 'fulfilled' }),
        (reason: unknown): Outcome => ({ status: 'rejected', reason }),
      ),
    });
    return promise;
  }
  function admit(role: 'owner' | 'guest', backendId = 'host-a') {
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: backendId, windowBackendId: backendId }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    // Canonical acknowledged-subscription fixture action; no event or application root is started.
    store.dispatch(daemonEventsSubscribed());
    const context = selectPrincipalConnectionContext.select(store.state);
    expect(context).not.toBeNull();
    if (context === null) throw new Error('Expected an admitted repository fixture context');
    const { principal } = createAdmittedLegacyPrincipal(
      {
        connections: { activeId: backendId, windowBackendId: backendId },
        daemonHealth: { connectionGeneration: store.state.daemonHealth.connectionGeneration },
        workspaceEvents: {
          subscriptionGeneration: store.state.workspaceEvents.subscriptionGeneration,
        },
      },
      role,
    );
    expect(principal.context).toBe(context);
    if (principal.snapshot === null) throw new Error('Expected a principal snapshot');
    store.dispatch(principalContextChanged(context));
    store.dispatch(
      principalReceived({ context, invalidation: 0, presentationVersion: 0 }, principal.snapshot),
    );
    expect(selectCanAdministerHost.select(store.state)).toBe(role === 'owner');
    return context;
  }
  function emit(channel: string, payload: unknown) {
    for (const callback of [...(listeners.get(channel)?.values() ?? [])]) callback(payload);
  }
  function hold(method: 'repo.list' | 'settings.get') {
    const reply = deferred<unknown>();
    releases.push(() => reply.resolve(method === 'repo.list' ? { repos: [] } : wireSetting([])));
    if (method === 'repo.list') repoReply = reply.promise;
    else settingReply = reply.promise;
    return reply;
  }
  return {
    api,
    request,
    admit,
    emit,
    hold,
    track,
    read: () => track(readKnownRepositories()),
    setRepos: (next: unknown) => {
      repoReply = next;
    },
    setSetting: (next: unknown) => {
      settingReply = next;
    },
    registrations,
  };
}

describe('inactive known-repository binding with the actual React backend and settings owner', () => {
  it('uses the existing settings cache and exact real preload requests without creating a second reader cache', async () => {
    h.admit('owner');
    const pick = repo('acme/pick', '2026-03-01', 'https://github.com/acme/pick');
    const local = repo('/local', '2026-02-01');
    h.setSetting(wireSetting([pick]));
    h.setRepos({ repos: [local, repo('/cache/.clones/internal')] });
    const cached = await h.track(settingsRuntime.readSetting('repos.known'));
    const first = await h.read();
    const second = await h.read();
    expect(first).toEqual({ success: true, data: [pick, local] });
    expect(second.data[0]).toBe(first.data[0]);
    if (!cached) throw new Error('Expected the known-repositories settings receipt');
    expect(first.data[0]).toBe((cached.value as KnownRepo[])[0]);
    expect(h.api.invoke.mock.calls).toEqual([
      ['backend:request', { method: 'settings.get', params: { path: 'repos.known' } }],
      ['backend:request', { method: 'repo.list', params: undefined }],
      ['backend:request', { method: 'repo.list', params: undefined }],
    ]);
    expect(h.registrations.map(([channel]) => channel)).toEqual([
      'backend:notification',
      'backend:status',
    ]);
  });

  it('coalesces simultaneous settings reads through the same genuine runtime pending read', async () => {
    h.admit('owner');
    const reply = h.hold('settings.get');
    const a = h.read();
    const b = h.read();
    await vi.waitFor(() =>
      expect(h.request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(1),
    );
    const shared = h.track(settingsRuntime.readSetting('repos.known'));
    const pick = repo('acme/shared', '2026-03-01', 'https://github.com/acme/shared');
    reply.resolve(wireSetting([pick]));
    const [first, second, cached] = await Promise.all([a, b, shared]);
    expect(first).toEqual({ success: true, data: [pick] });
    expect(second.data[0]).toBe(first.data[0]);
    if (!cached) throw new Error('Expected the known-repositories settings receipt');
    expect(first.data[0]).toBe((cached.value as KnownRepo[])[0]);
    expect(h.request.mock.calls).toEqual([
      ['repo.list', undefined],
      ['repo.list', undefined],
      ['settings.get', { path: 'repos.known' }],
    ]);
  });

  it('keeps the existing matching-null policy and never reads owner settings before admission', async () => {
    expect(selectPrincipalConnectionContext.select(store.state)).toBeNull();
    const local = repo('/visible');
    h.setRepos({ repos: [local] });
    expect(await h.read()).toEqual({ success: true, data: [local] });
    expect(h.api.invoke.mock.calls).toEqual([
      ['backend:request', { method: 'repo.list', params: undefined }],
    ]);
  });

  it('reads registry repositories for a guest without probing owner settings', async () => {
    h.admit('guest');
    h.setRepos({ repos: [repo('/guest-visible')] });
    expect((await h.read()).data.map(({ path }) => path)).toEqual(['/guest-visible']);
    expect(h.request.mock.calls).toEqual([['repo.list', undefined]]);
  });

  it('drops a held old-host registry reply before the settings read starts', async () => {
    const before = h.admit('owner');
    const reply = h.hold('repo.list');
    const pending = h.read();
    const after = h.admit('owner', 'host-b');
    expect(after).not.toBe(before);
    reply.resolve({ repos: [repo('/old-host')] });
    expect(await pending).toEqual({ success: true, data: [] });
    expect(h.request.mock.calls).toEqual([['repo.list', undefined]]);
  });

  it('retires a held settings read on reconnect, drops old repositories, and permits a fresh current-host read', async () => {
    h.admit('owner');
    h.setRepos({ repos: [repo('/old-host')] });
    const reply = h.hold('settings.get');
    const old = h.read();
    await vi.waitFor(() =>
      expect(h.request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(1),
    );
    const strict = h.track(settingsRuntime.readSetting('repos.known'), true);
    h.emit(IPC_CHANNELS.BACKEND.STATUS, { status: 'connected', reconnected: true });
    h.admit('owner', 'host-b');
    reply.resolve(wireSetting([repo('old/pick', '1', 'https://github.com/old/pick')]));
    await expect(strict).rejects.toThrow('Settings connection retired');
    expect(await old).toEqual({ success: true, data: [] });
    const current = repo('new/pick', '2', 'https://github.com/new/pick');
    h.setRepos({ repos: [] });
    h.setSetting(wireSetting([current]));
    expect(await h.read()).toEqual({ success: true, data: [current] });
    expect(h.request.mock.calls.map(([method]) => method)).toEqual([
      'repo.list',
      'settings.get',
      'repo.list',
      'settings.get',
    ]);
  });

  it('retains registry results on settings failure and retries the uncached read later', async () => {
    h.admit('owner');
    const local = repo('/local');
    h.setRepos({ repos: [local] });
    const reply = h.hold('settings.get');
    const first = h.read();
    await vi.waitFor(() =>
      expect(h.request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(1),
    );
    reply.reject(new Error('Settings unavailable'));
    expect(await first).toEqual({ success: true, data: [local] });
    const pick = repo('retry/pick', '2026-03-01', 'https://github.com/retry/pick');
    h.setSetting(wireSetting([pick]));
    expect(await h.read()).toEqual({ success: true, data: [pick, local] });
    expect(h.request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(2);
  });

  it.each([{}, wireSetting({ unexpected: true })])(
    'keeps registry results for malformed settings reply %j',
    async (reply) => {
      h.admit('owner');
      const local = repo('/local');
      h.setRepos({ repos: [local] });
      h.setSetting(reply);
      expect(await h.read()).toEqual({ success: true, data: [local] });
      expect(h.request.mock.calls).toEqual([
        ['repo.list', undefined],
        ['settings.get', { path: 'repos.known' }],
      ]);
    },
  );

  it('invalidates the shared settings cache through the real notification listener', async () => {
    h.admit('owner');
    h.setSetting(wireSetting([repo('old/pick', '1', 'https://github.com/old/pick')]));
    expect((await h.read()).data.map(({ path }) => path)).toEqual(['old/pick']);
    h.setSetting(wireSetting([repo('new/pick', '2', 'https://github.com/new/pick')]));
    h.emit(IPC_CHANNELS.BACKEND.NOTIFICATION, {
      method: 'events.event',
      params: { type: 'settings:changed' },
    });
    expect((await h.read()).data.map(({ path }) => path)).toEqual(['new/pick']);
    expect(h.request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(2);
  });

  it('propagates a real bridge failure and never substitutes native recents', async () => {
    h.admit('owner');
    const failure = new Error('Controlled daemon failure');
    h.request.mockRejectedValueOnce(failure);
    await expect(h.track(readKnownRepositories(), true)).rejects.toBe(failure);
    expect(h.api.invoke.mock.calls).toEqual([
      ['backend:request', { method: 'repo.list', params: undefined }],
    ]);
    Reflect.deleteProperty(window, 'electronAPI');
    await expect(h.track(readKnownRepositories(), true)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(h.api.invoke.mock.calls).toHaveLength(1);
  });
});

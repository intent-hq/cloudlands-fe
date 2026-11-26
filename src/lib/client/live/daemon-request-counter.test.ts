import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDaemon } from '../../../test/fake-daemon-socket';
import {
  DAEMON_REQUEST_COUNTER_STORAGE_KEY,
  disableDaemonRequestCounter,
  enableDaemonRequestCounter,
  enableDaemonRequestCounterIfOptedIn,
  recordDaemonRequest,
} from './daemon-request-counter';
import { createBrowserWebSocketTransport } from './browser-websocket-transport';
import { createElectronIpcBackendTransport } from './electron-ipc-transport';

beforeEach(() => vi.stubEnv('DEV', true));
afterEach(() => {
  disableDaemonRequestCounter();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('daemon request counter', () => {
  it('records nothing until enabled', () => {
    recordDaemonRequest('workspace.list');
    const counter = enableDaemonRequestCounter()!;
    expect(counter.counts()).toEqual({});
    expect(window.__intentRequestCounter).toBe(counter);
  });

  it('counts by method, sorted, and resets to zero', () => {
    const counter = enableDaemonRequestCounter()!;
    for (const method of ['workspace.list', 'agent.pendingPermissions', 'workspace.list'])
      recordDaemonRequest(method);
    expect(Object.entries(counter.counts())).toEqual([
      ['agent.pendingPermissions', 1],
      ['workspace.list', 2],
    ]);
    expect(counter.count('git.getRemoteUrl')).toBe(0);
    counter.reset();
    expect(counter.counts()).toEqual({});
  });

  it('reports only methods over their budget', () => {
    const counter = enableDaemonRequestCounter()!;
    for (let i = 0; i < 6; i++) recordDaemonRequest('workspace.list');
    recordDaemonRequest('agent.pendingPermissions');
    expect(
      counter.overBudget({
        'workspace.list': 5,
        'agent.pendingPermissions': 1,
        'git.getRemoteUrl': 0,
      }),
    ).toEqual([{ method: 'workspace.list', count: 6, budget: 5 }]);
  });

  it('stays off in production builds, even when opted in', () => {
    vi.stubEnv('DEV', false);
    window.localStorage.setItem(DAEMON_REQUEST_COUNTER_STORAGE_KEY, '1');
    expect(enableDaemonRequestCounter()).toBeNull();
    enableDaemonRequestCounterIfOptedIn();
    recordDaemonRequest('workspace.list');
    expect(window.__intentRequestCounter).toBeUndefined();
  });

  it('enables from the dev opt-in flag only', () => {
    enableDaemonRequestCounterIfOptedIn();
    expect(window.__intentRequestCounter).toBeUndefined();
    window.localStorage.setItem(DAEMON_REQUEST_COUNTER_STORAGE_KEY, '1');
    enableDaemonRequestCounterIfOptedIn();
    expect(window.__intentRequestCounter?.counts()).toEqual({});
  });

  it('counts each request the browser WebSocket transport puts on the wire', async () => {
    const counter = enableDaemonRequestCounter()!;
    const daemon = createFakeDaemon();
    daemon.handle('workspace.list', () => ({ workspaces: [] }));
    vi.stubGlobal('WebSocket', daemon.Socket);
    const transport = createBrowserWebSocketTransport({ url: 'ws://127.0.0.1:1/ws' });
    try {
      await transport.request('workspace.list');
      await transport.request('workspace.list', { nextToken: '1' });
      await transport.subscribe({});
      expect(counter.counts()).toEqual({
        'client.hello': 1,
        'events.subscribe': 1,
        'workspace.list': 2,
      });
      expect(daemon.frames.map((frame) => frame.method).sort()).toEqual(
        Object.entries(counter.counts()).flatMap(([method, n]) => Array(n).fill(method)),
      );
    } finally {
      transport.dispose?.();
    }
  });

  it('counts each request the Electron IPC transport forwards', async () => {
    const counter = enableDaemonRequestCounter()!;
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      invoke: vi.fn(async () => ({ ok: true, result: {} })),
      on: () => 'listener',
      offById: () => {},
    };
    const transport = createElectronIpcBackendTransport();
    await transport.request('agent.pendingPermissions', {});
    await transport.subscribe({});
    await transport.unsubscribe('subscription-1');
    expect(counter.counts()).toEqual({
      'agent.pendingPermissions': 1,
      'events.subscribe': 1,
      'events.unsubscribe': 1,
    });
  });
});

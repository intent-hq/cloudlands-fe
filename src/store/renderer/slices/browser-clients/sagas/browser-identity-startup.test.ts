/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWebSocketTransport } from '$lib/client/live/browser-websocket-transport';

/** Only the daemon wire is fake: mount, client facade, recovery and identity are real. */
describe('mounted browser identity observation', () => {
  const originalApi = window.electronAPI;
  let dispose: (() => void) | undefined;
  const cancel: (() => void)[] = [];
  let transport: BrowserWebSocketTransport | undefined;
  let supported = true;
  let clientId = 'mounted-client';
  let holdHello = false;
  let finishHello: (() => void) | undefined;
  const frames: { id: number; method: string; params?: unknown }[] = [];
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      queueMicrotask(() => this.onopen?.());
    }
    close() {}
    send(data: string) {
      const frame = JSON.parse(data);
      frames.push(frame);
      // Bound a broken hello loop so the regression can report its assertion.
      if (
        frame.method === 'client.hello' &&
        frames.filter((f) => f.method === 'client.hello').length > 2
      )
        return;
      let result: unknown = {};
      if (frame.method === 'client.hello')
        result = {
          clientId,
          server: { capabilities: { hostMembership: 1, eventStreamRecovery: supported ? 1 : 0 } },
        };
      if (frame.method === 'principal.me')
        result = {
          id: 'caller',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
          hostRole: 'owner',
          hostMembershipRevision: 0,
        };
      if (frame.method === 'system.status')
        result = {
          running: true,
          listenMode: 'wss',
          transports: ['wss'],
          port: null,
          protocolVersion: '2.6',
          host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'remote' },
        };
      if (frame.method === 'events.subscribe')
        result = {
          subscriptionId: `subscription-${frame.id}`,
          ...(supported ? { lossRecovery: 1 } : {}),
        };
      if (frame.method === 'events.fence') result = frame.params;
      if (frame.method === 'client.list')
        result = {
          clients: [
            {
              clientId,
              capabilities: { browserExec: true },
              connections: 1,
              transports: ['wss'],
              connectedAt: '2026-10-13',
            },
          ],
        };
      if (frame.method === 'workspace.getBrowserClient')
        result = {
          browserClient: { source: 'default', resolved: { clientId } },
        };
      const respond = () =>
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) });
      if (frame.method === 'client.hello' && holdHello) finishHello = respond;
      else queueMicrotask(respond);
    }
  }
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('DEV', true);
    vi.stubEnv('INTENT_BUILD_TARGET', 'web');
    vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://127.0.0.1:7376/intentd/ws?token=test-secret');
    delete (window as Partial<Window>).electronAPI;
    vi.stubGlobal('WebSocket', Socket);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    frames.length = 0;
    clientId = 'mounted-client';
    holdHello = false;
    finishHello = undefined;
    await import('$lib/browser-mock');
  });
  afterEach(() => {
    cancel.splice(0).forEach((stop) => stop());
    transport?.dispose();
    dispose?.();
    transport = undefined;
    dispose = undefined;
    window.electronAPI = originalApi;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it.each([true, false])(
    'mounts with recovery support %s without a second hello or retired identity',
    async (recoverySupported) => {
      supported = recoverySupported;
      const { store } = await import('../../../store');
      const { connectionsSaga } = await import('../../connections/sagas/connections-saga');
      const { daemonHealthSaga } = await import('../../daemon-health/sagas/daemon-health-saga');
      const { daemonEventsSaga } = await import('../../workspace-events/sagas/daemon-events-saga');
      const { principalSaga } = await import('../../principal/sagas/principal-saga');
      const { browserClientsSaga } = await import('./browser-clients-saga');
      const { resolveBackendTransport } =
        await import('$lib/client/live/backend-transport-factory');
      const { browserClientsConsumerMounted } = await import('../browser-clients-slice');
      dispose = store.init();
      cancel.push(
        store.runSaga(connectionsSaga),
        store.runSaga(daemonHealthSaga),
        store.runSaga(daemonEventsSaga),
        store.runSaga(principalSaga),
        store.runSaga(browserClientsSaga),
      );
      transport = resolveBackendTransport() as BrowserWebSocketTransport;
      await vi.waitFor(() => expect(store.state.principal.status).toBe('ready'));
      await vi.waitFor(() => expect(store.state.workspaceEvents.subscriptionPending).toBe(false));
      const session = await transport.captureEventRecovery();
      const subscriptions = frames.filter((frame) => frame.method === 'events.subscribe').length;
      store.dispatch(browserClientsConsumerMounted('mounted-workspace', 'test-browser'));
      await vi.waitFor(() =>
        expect(frames.some((frame) => frame.method === 'workspace.getBrowserClient')).toBe(true),
      );
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
      await vi.waitFor(() =>
        expect(
          store.state.browserClients.byWorkspaceId['mounted-workspace']?.browserClient?.resolved
            ?.clientId,
        ).toBe('mounted-client'),
      );
      expect(store.state.browserClients.ownClientId).toBe('mounted-client');
      expect(store.state.browserClients.ownClientIdConfirmed).toBe(true);
      expect(session.isCurrent()).toBe(true);
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
      expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(
        subscriptions,
      );
      expect(frames.filter((frame) => frame.method === 'client.list')).toHaveLength(1);
      expect(frames.filter((frame) => frame.method === 'workspace.getBrowserClient')).toHaveLength(
        1,
      );
      const { LiveClientsClient } = await import('$lib/client/live/live-clients-client');
      const client = new LiveClientsClient();
      holdHello = true;
      clientId = 'reconfirmed-client';
      const hello = transport.request('client.hello', {});
      await vi.waitFor(() => expect(finishHello).toBeDefined());
      expect(session.isCurrent()).toBe(false);
      await expect(client.ownClientId()).rejects.toThrow('not confirmed');
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(2);
      finishHello!();
      await hello;
      expect(await client.ownClientId()).toBe('reconfirmed-client');
      expect(frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(2);
      session.dispose();
    },
  );
});

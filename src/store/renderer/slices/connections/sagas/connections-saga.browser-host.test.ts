/**
 * The connections saga on a page served by intent-web (`connections.manage`):
 * every connection write goes to the host's HTTP API, with the request shapes
 * the intent-web server accepts (src/features/intent-web/main/intent-web-server.ts),
 * and host SSE pushes refresh the list for this tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify }));
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import { createConnectionsHarness } from '../test-harness';
import {
  addConnectionRequested,
  browserHostDetected,
  captureFingerprintRequested,
  connectionTunnelRequested,
  forgetConnectionRequested,
  openConnectionRequested,
  rotateConnectionSecretRequested,
  testConnectionRequested,
  updateConnectionRequested,
} from '../connections-slice';
import {
  settingsFormOpened,
  settingsFormRequestSettled,
} from '../../settings-events/settings-events-slice';
import {
  selectConnections,
  selectCurrentConnectionId,
  selectNoBackendBound,
} from '../connections-selectors';

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Build box',
  accent: 'blue',
  host: '192.0.2.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

type ConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: unknown };

interface Call {
  url: string;
  method: string;
  body: unknown;
  contentType: string | null;
}

let calls: Call[];
let respond: (call: Call) => unknown;
let sources: FakeEventSource[];

class FakeEventSource {
  static readonly CLOSED = 2;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  readyState = 0;
  closed = false;
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    sources.push(this);
  }
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(name, listener);
  }
  close() {
    this.closed = true;
  }
  push(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  /** Fire a lifecycle event (`open`, `error`) with the given readyState. */
  fire(name: 'open' | 'error', readyState: number) {
    this.readyState = readyState;
    this.listeners.get(name)?.({} as MessageEvent<string>);
  }
}

function setHost(backendId: string | null, extra: Record<string, unknown> = {}) {
  (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__ = {
    backendId,
    intentdWsUrl: null,
    connectionsUrl: '/__intent-web/connections',
    eventsUrl: '/__intent-web/events',
    hostCapabilities: ['connections.manage'],
    tailcatAvailable: false,
    localAvailable: false,
    ...extra,
  };
}

const flush = () => vi.waitFor(() => Promise.resolve());

async function startHarness() {
  const dispatched: any[] = [];
  const harness = createConnectionsHarness(
    () => ({}),
    (action) => dispatched.push(action),
  );
  await harness.start();
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return { ...harness, dispatched };
}

beforeEach(() => {
  notify.error.mockClear();
  calls = [];
  sources = [];
  respond = () => ({ connections: [REMOTE], activeId: null, windowBackendId: null });
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        contentType: new Headers(init.headers).get('content-type'),
      };
      calls.push(call);
      const body = respond(call) as { httpStatus?: number };
      return new Response(JSON.stringify(body), { status: body?.httpStatus ?? 200 });
    }),
  );
});

afterEach(() => {
  delete (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

describe('connections saga on an intent-web host', () => {
  it('records the host and binds an unbound tab to no backend', async () => {
    setHost(null);
    const { store, dispatched, stop } = await startHarness();
    expect(dispatched).toContainEqual(
      browserHostDetected({
        manageConnections: true,
        backendBound: false,
        tailcatAvailable: false,
      }),
    );
    expect(calls[0]).toMatchObject({ url: '/__intent-web/connections', method: 'GET' });
    await vi.waitFor(() =>
      expect(selectConnections.select(store.state).map((c) => c.id)).toEqual(['remote-1']),
    );
    expect(selectNoBackendBound.select(store.state)).toBe(true);
    expect(selectCurrentConnectionId.select(store.state)).toBe('');
    await stop();
  });

  it('sends add, update, test, rotate, capture and forget to the host API', async () => {
    setHost('remote-1');
    respond = (call) => {
      if (call.method === 'GET') return { connections: [REMOTE], activeId: 'remote-1' };
      if (call.url.endsWith('/capture-fingerprint'))
        return {
          ok: true,
          fingerprint: 'AB:CD',
          tokenValid: false,
          statusCode: 401,
          connected: false,
        };
      if (call.method === 'POST' && call.url === '/__intent-web/connections')
        return { connection: REMOTE, switched: false };
      if (call.url.endsWith('/test')) return { status: 'success', fingerprint: 'AB:CD' };
      if (call.method === 'DELETE') return { ok: true };
      return { status: 'updated', connection: REMOTE };
    };
    const { store, stop } = await startHarness();
    calls = [];

    const capture = captureFingerprintRequested({ host: '192.0.2.5', port: 8443, token: 't0' });
    store.dispatch(capture);
    await expect(capture.promise).resolves.toEqual({
      fingerprint: 'AB:CD',
      tokenValid: false,
      statusCode: 401,
    });

    const add = addConnectionRequested({
      label: 'Build box',
      accent: 'blue',
      host: '192.0.2.5',
      port: 8443,
      fingerprint: 'AB:CD',
      token: 't1',
      detectHosts: true,
      syncExcluded: true,
    });
    store.dispatch(add);
    await expect(add.promise).resolves.toEqual({ connection: REMOTE, switched: false });

    const update = updateConnectionRequested({
      id: 'remote-1',
      label: 'Renamed',
      accent: 'indigo',
      host: '192.0.2.6',
      port: 9443,
      confirmedFingerprint: 'EF:01',
    });
    store.dispatch(update);
    await expect(update.promise).resolves.toEqual({ status: 'updated', connection: REMOTE });

    const test = testConnectionRequested({ id: 'remote-1', host: '192.0.2.6', port: 9443 });
    store.dispatch(test);
    await expect(test.promise).resolves.toEqual({ status: 'success', fingerprint: 'AB:CD' });

    const rotate = rotateConnectionSecretRequested({ id: 'remote-1', token: 't2' });
    store.dispatch(rotate);
    await expect(rotate.promise).resolves.toEqual({ status: 'updated', connection: REMOTE });

    const forget = forgetConnectionRequested('remote-1');
    store.dispatch(forget);
    await forget.promise;

    expect(calls).toEqual([
      {
        url: '/__intent-web/connections/capture-fingerprint',
        method: 'POST',
        body: { host: '192.0.2.5', port: 8443, token: 't0' },
        contentType: 'application/json',
      },
      {
        url: '/__intent-web/connections',
        method: 'POST',
        body: {
          label: 'Build box',
          accent: 'blue',
          host: '192.0.2.5',
          port: 8443,
          fingerprint: 'AB:CD',
          token: 't1',
          detectHosts: true,
        },
        contentType: 'application/json',
      },
      {
        url: '/__intent-web/connections/remote-1',
        method: 'PATCH',
        body: {
          label: 'Renamed',
          accent: 'indigo',
          host: '192.0.2.6',
          port: 9443,
          confirmedFingerprint: 'EF:01',
        },
        contentType: 'application/json',
      },
      {
        url: '/__intent-web/connections/remote-1/test',
        method: 'POST',
        body: { host: '192.0.2.6', port: 9443 },
        contentType: 'application/json',
      },
      {
        url: '/__intent-web/connections/remote-1/rotate-secret',
        method: 'POST',
        body: { token: 't2' },
        contentType: 'application/json',
      },
      {
        url: '/__intent-web/connections/remote-1',
        method: 'DELETE',
        body: {},
        contentType: 'application/json',
      },
    ]);
    await stop();
  });

  it('fails the action when the host rejects a write', async () => {
    setHost('remote-1');
    respond = () => ({ connections: [], activeId: 'remote-1' });
    const { store, stop } = await startHarness();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const forget = forgetConnectionRequested('remote-1');
    store.dispatch(forget);
    await expect(forget.promise).rejects.toThrow(/403/);
    await stop();
  });

  it('opens another backend in a new tab from a bound tab', async () => {
    setHost('remote-1');
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { store, stop } = await startHarness();
    const action = openConnectionRequested('local');
    store.dispatch(action);
    await expect(action.promise).resolves.toEqual({ status: 'opened', id: 'local' });
    expect(open).toHaveBeenCalledWith('/?backend=local', '_blank', 'noopener');
    await stop();
  });

  it('reads and writes the tunnel setting through the host', async () => {
    setHost('remote-1');
    respond = (call) =>
      call.url.endsWith('/tunnel')
        ? { supported: true, enabled: call.method === 'PUT' }
        : { connections: [REMOTE], activeId: 'remote-1' };
    const { store, dispatched, stop } = await startHarness();
    calls = [];
    const session = { formId: 'tunnel-form', sessionId: 's1' };
    store.dispatch(settingsFormOpened(session, 'connection-tunnel'));
    store.dispatch(
      connectionTunnelRequested(
        { ...session, requestId: 'r1', resource: 'load' },
        { kind: 'load', id: 'remote-1' },
      ),
    );
    store.dispatch(
      connectionTunnelRequested(
        { ...session, requestId: 'r2', resource: 'save' },
        { kind: 'set', id: 'remote-1', enabled: true },
      ),
    );
    await vi.waitFor(() =>
      expect(dispatched).toContainEqual(
        settingsFormRequestSettled(
          { ...session, requestId: 'r2', resource: 'save' },
          { status: 'succeeded', values: { supported: true, enabled: true } },
        ),
      ),
    );
    expect(calls).toEqual([
      {
        url: '/__intent-web/connections/remote-1/tunnel',
        method: 'GET',
        body: undefined,
        contentType: null,
      },
      {
        url: '/__intent-web/connections/remote-1/tunnel',
        method: 'PUT',
        body: { enabled: true },
        contentType: 'application/json',
      },
    ]);
    await stop();
  });

  it('applies host pushes to this tab and closes the stream on stop', async () => {
    setHost('remote-1');
    respond = () => ({ connections: [REMOTE], activeId: 'remote-1' });
    const { store, stop } = await startHarness();
    expect(sources.map((s) => [s.url, s.init])).toEqual([
      ['/__intent-web/events', { withCredentials: true }],
    ]);
    const other = { ...REMOTE, id: 'remote-2', host: '192.0.2.9' };
    // The host's push names its own default backend; this tab stays on remote-1.
    sources[0].push('connections:changed', {
      connections: [REMOTE, other],
      activeId: 'remote-2',
      windowBackendId: 'remote-2',
    });
    await vi.waitFor(() =>
      expect(selectConnections.select(store.state).map((c) => c.id)).toEqual([
        'remote-1',
        'remote-2',
      ]),
    );
    expect(selectCurrentConnectionId.select(store.state)).toBe('remote-1');
    sources[0].push('connections:auth-rejected', {
      id: 'remote-1',
      host: '192.0.2.5',
      port: 8443,
      statusCode: 401,
    });
    await vi.waitFor(() =>
      expect(store.state.connections.authRejected).toEqual({
        id: 'remote-1',
        host: '192.0.2.5',
        port: 8443,
        statusCode: 401,
      }),
    );
    await stop();
    await flush();
    expect(sources[0].closed).toBe(true);
  });

  it('lists again after the event stream reconnects', async () => {
    setHost('remote-1');
    respond = () => ({ connections: [REMOTE], activeId: 'remote-1' });
    const { store, stop } = await startHarness();
    sources[0].fire('open', 1);
    calls = [];
    const other = { ...REMOTE, id: 'remote-2', host: '192.0.2.9' };
    // A machine added while the stream was down: its push was lost.
    respond = () => ({ connections: [REMOTE, other], activeId: 'remote-2' });
    sources[0].fire('error', 0);
    sources[0].fire('open', 1);
    await vi.waitFor(() =>
      expect(selectConnections.select(store.state).map((c) => c.id)).toEqual([
        'remote-1',
        'remote-2',
      ]),
    );
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /__intent-web/connections?backend=remote-1',
    ]);
    expect(selectCurrentConnectionId.select(store.state)).toBe('remote-1');
    expect(notify.error).not.toHaveBeenCalled();
    await stop();
  });

  it('asks the user to sign in again when the stream closes on an ended session', async () => {
    setHost('remote-1');
    respond = () => ({ connections: [REMOTE], activeId: 'remote-1' });
    const { stop } = await startHarness();
    respond = () => ({ httpStatus: 401 });
    sources[0].fire('error', FakeEventSource.CLOSED);
    await vi.waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        m.intentWeb_sessionEnded_error(),
        expect.objectContaining({
          action: expect.objectContaining({ label: m.intentWeb_signIn_action() }),
        }),
      ),
    );
    await stop();
  });

  it('refreshes the list and reports stopped updates when the stream closes', async () => {
    setHost('remote-1');
    respond = () => ({ connections: [REMOTE], activeId: 'remote-1' });
    const { store, stop } = await startHarness();
    respond = () => ({ connections: [], activeId: 'remote-1' });
    sources[0].fire('error', FakeEventSource.CLOSED);
    await vi.waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        m.intentWeb_updatesStopped_error(),
        expect.objectContaining({
          action: expect.objectContaining({ label: m.intentWeb_reload_action() }),
        }),
      ),
    );
    expect(selectConnections.select(store.state)).toEqual([]);
    await stop();
  });

  it('keeps writes on Electron IPC when the host does not manage connections', async () => {
    setHost('remote-1', { hostCapabilities: [] });
    respond = () => ({ connections: [REMOTE], activeId: 'remote-1' });
    const { store, dispatched, stop } = await startHarness();
    expect(dispatched).toContainEqual(
      browserHostDetected({
        manageConnections: false,
        backendBound: true,
        tailcatAvailable: false,
      }),
    );
    expect(sources).toEqual([]);
    calls = [];
    const forget = forgetConnectionRequested('remote-1');
    store.dispatch(forget);
    await expect(forget.promise).rejects.toThrow(/electronAPI is not available/);
    expect(calls).toEqual([]);
    await stop();
  });
});

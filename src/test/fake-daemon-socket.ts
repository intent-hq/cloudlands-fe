/**
 * A scripted daemon behind the browser WebSocket transport, for tests that boot
 * the real renderer (store, sagas, seeders, transport) without an intentd.
 *
 * Install the class with `vi.stubGlobal('WebSocket', daemon.Socket)`. Each
 * request frame is answered from `handlers[method]` (a promise holds the reply
 * until it settles), else from the browser mock's daemon replies
 * (`mockDaemonMethodReply`), else with a `null` result, which consumers treat
 * as an unusable read (they log and carry on). `notify()` pushes a daemon
 * notification such as `events.event`, and `dropConnections()` closes every
 * open socket the way a daemon restart does, so the transport reconnects.
 */
import { mockDaemonMethodReply } from '$lib/browser-mock';
import { CURRENT_PROTOCOL_VERSION } from './current-protocol-version';

type FakeDaemonFrame = { id: number; method: string; params?: Record<string, unknown> };
export type FakeDaemonHandler = (params: Record<string, unknown> | undefined) => unknown;

export interface FakeDaemon {
  /** Constructor to stub as the global `WebSocket`. */
  Socket: new (url: string) => unknown;
  /** Every request frame received, across connections. */
  frames: FakeDaemonFrame[];
  /** Replace or add a method handler. */
  handle(method: string, handler: FakeDaemonHandler): void;
  /** Push a JSON-RPC notification to every open socket. */
  notify(method: string, params: unknown): void;
  /** Close every open socket (transport sees an unexpected close and reconnects). */
  dropConnections(): void;
  /** Number of sockets opened so far. */
  connections(): number;
}

/** Answers every startup read with a minimal valid owner session. */
function defaultDaemonHandlers(): Record<string, FakeDaemonHandler> {
  return {
    'client.hello': () => ({
      clientId: 'request-budget-client',
      server: { capabilities: { hostMembership: 1, boundedReads: 1 } },
    }),
    'principal.me': () => ({
      id: 'caller',
      login: null,
      displayName: null,
      avatarUrl: null,
      isAdministrator: true,
      hostRole: 'owner',
      hostMembershipRevision: 0,
    }),
    'system.status': () => ({
      running: true,
      listenMode: 'wss',
      transports: ['wss'],
      port: null,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'remote' },
    }),
    'events.subscribe': () => ({ subscriptionId: `subscription-${Math.random()}` }),
    'events.unsubscribe': () => ({}),
  };
}

export function createFakeDaemon(
  handlers: Record<string, FakeDaemonHandler> = defaultDaemonHandlers(),
): FakeDaemon {
  const frames: FakeDaemonFrame[] = [];
  const open = new Set<FakeDaemonSocket>();
  let opened = 0;

  class FakeDaemonSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event?: unknown) => void) | null = null;
    onerror: (() => void) | null = null;
    readyState = 0;
    private closed = false;

    constructor(readonly url: string) {
      opened += 1;
      open.add(this);
      queueMicrotask(() => {
        if (this.closed) return;
        this.readyState = 1;
        this.onopen?.();
      });
    }

    close() {
      this.shut();
    }

    shut() {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      open.delete(this);
      this.onclose?.({ code: 1006, reason: '', wasClean: false });
    }

    send(data: string) {
      if (this.closed) throw new Error('socket closed');
      const frame = JSON.parse(data) as FakeDaemonFrame;
      frames.push(frame);
      const handler = handlers[frame.method];
      const answer = (reply: Record<string, unknown>) =>
        queueMicrotask(() => {
          if (this.closed) return;
          this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...reply }) });
        });
      const fail = (error: unknown) => answer({ error: { code: -32603, message: String(error) } });
      try {
        if (!handler) {
          answer(mockDaemonMethodReply(frame.method, frame.params) ?? { result: null });
          return;
        }
        const result = handler(frame.params);
        if (result instanceof Promise)
          result.then((value) => answer({ result: value ?? null }), fail);
        else answer({ result: result ?? null });
      } catch (error) {
        fail(error);
      }
    }

    push(message: string) {
      if (!this.closed && this.readyState === 1) this.onmessage?.({ data: message });
    }
  }

  return {
    Socket: FakeDaemonSocket,
    frames,
    handle(method, handler) {
      handlers[method] = handler;
    },
    notify(method, params) {
      const message = JSON.stringify({ jsonrpc: '2.0', method, params });
      for (const socket of [...open]) socket.push(message);
    },
    dropConnections() {
      for (const socket of [...open]) socket.shut();
    },
    connections: () => opened,
  };
}

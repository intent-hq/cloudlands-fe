/**
 * Daemon startup readiness (docs/protocol/startup-readiness.md): a restarted
 * daemon answers `client.hello` with `-32012` until it is ready. The client
 * must hold a starting state, poll `system.startupStatus`, re-hello on a fresh
 * socket once ready, and report a failed start as a failure.
 */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyStartupReply, type DaemonStartupState } from '$shared/daemon-startup';
import { AuthRejectedError } from './backend-connection';
import { JsonRpcClient, type ConnectionStatus } from './json-rpc-client';

class FakeSocket extends EventEmitter {
  frames: Array<{ id: number; method: string; params?: unknown }> = [];
  destroyed = false;
  write(data: string): boolean {
    this.frames.push(JSON.parse(data));
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  open(): void {
    this.emit('connect');
  }
  /** The daemon closes the socket (bootstrap handoff or crash). */
  close(): void {
    this.emit('close');
  }
  last(method: string) {
    const frame = [...this.frames].reverse().find((f) => f.method === method);
    if (!frame) throw new Error(`no ${method} frame`);
    return frame;
  }
  result(id: number, result: unknown): void {
    this.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`));
  }
  error(id: number, error: unknown): void {
    this.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`));
  }
}

type Phase = 'preparing' | 'indexing' | 'finalizing' | 'ready' | 'failed';

/** A schema-1 snapshot exactly as docs/protocol/startup-readiness.md defines it. */
function snapshot(phase: Phase, extra: Record<string, unknown> = {}) {
  const terminal = phase === 'ready' || phase === 'failed';
  return {
    startupStatus: 1,
    daemonVersion: '0.11.81',
    attemptId: 'boot-a',
    phase,
    elapsedMs: 1200,
    phaseElapsedMs: terminal ? 0 : 1200,
    progressAgeMs: terminal ? 0 : 1200,
    ...(terminal ? {} : { retryAfterMs: 1000 }),
    ...(phase === 'finalizing' ? { finalizingStep: 'services' } : {}),
    ...(phase === 'failed'
      ? {
          failure: { code: 'startup-failed', message: 'Daemon startup failed. Check daemon logs.' },
        }
      : {}),
    ...extra,
  };
}

function notReady(startup = snapshot('preparing')) {
  return {
    code: -32012,
    message: 'Daemon not ready',
    data: {
      code: 'daemon-not-ready',
      retryable: true,
      retryAfterMs: (startup as { retryAfterMs?: number }).retryAfterMs,
      startup,
    },
  };
}

function startupFailed() {
  return {
    code: -32012,
    message: 'Daemon startup failed',
    data: { code: 'daemon-startup-failed', retryable: false, startup: snapshot('failed') },
  };
}

const HELLO_OK = { clientId: 'desktop', server: { capabilities: {} } };

function make(options: ConstructorParameters<typeof JsonRpcClient>[0] = {}) {
  const sockets: FakeSocket[] = [];
  const client = new JsonRpcClient({
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as Duplex;
    },
    heartbeatIntervalMs: 0,
    requestTimeoutMs: 30_000,
    reconnectDelayMs: 100,
    maxReconnectDelayMs: 100,
    helloParams: () => ({ clientId: 'desktop' }),
    ...options,
  });
  client.on('error', () => {});
  const statuses: ConnectionStatus[] = [];
  const startups: Array<DaemonStartupState | null> = [];
  const reconnected = vi.fn();
  client.on('status', (status: ConnectionStatus) => statuses.push(status));
  client.on('startup', (state: DaemonStartupState | null) => startups.push(state));
  client.on('reconnected', reconnected);
  return { client, sockets, statuses, startups, reconnected };
}

/** Open socket `index` and answer its connect-time hello with the startup error. */
async function helloAnsweredStarting(sockets: FakeSocket[], index: number, error = notReady()) {
  sockets[index].open();
  await vi.advanceTimersByTimeAsync(0);
  sockets[index].error(sockets[index].last('client.hello').id, error);
  await vi.advanceTimersByTimeAsync(0);
}

describe('JsonRpcClient daemon startup readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a starting state, polls, then re-hellos on a fresh socket before reporting connected', async () => {
    const { client, sockets, statuses, startups, reconnected } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);

    expect(client.getStatus()).toBe('connecting');
    expect(client.getStartupState()).toMatchObject({
      state: 'starting',
      available: true,
      snapshot: { phase: 'preparing' },
    });
    expect(client.getRepositoryConnection()).toBeNull();

    // First poll after the daemon's retryAfterMs, on the same socket.
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    await vi.advanceTimersByTimeAsync(1);
    const poll = sockets[0].last('system.startupStatus');
    expect(poll.params).toBeUndefined();
    sockets[0].result(poll.id, snapshot('finalizing'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStartupState()?.snapshot?.phase).toBe('finalizing');

    await vi.advanceTimersByTimeAsync(1000);
    sockets[0].result(sockets[0].last('system.startupStatus').id, snapshot('ready'));
    await vi.advanceTimersByTimeAsync(0);
    // Ready: the bootstrap socket is left and one fresh socket is dialed.
    expect(sockets[0].destroyed).toBe(true);
    expect(client.getStatus()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).not.toContain('connected');
    sockets[1].result(sockets[1].last('client.hello').id, HELLO_OK);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getStatus()).toBe('connected');
    expect(client.getStartupState()).toBeNull();
    expect(client.getRepositoryConnection()).not.toBeNull();
    expect(reconnected).toHaveBeenCalledTimes(1);
    // Never reported disconnected while the daemon was starting.
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(startups.at(-1)).toBeNull();
    // Only status polls reached the starting daemon.
    expect(sockets[0].frames.map((f) => f.method)).toEqual([
      'client.hello',
      'system.startupStatus',
      'system.startupStatus',
    ]);
    client.dispose();
  });

  it('reconnects and re-hellos when the starting daemon closes its bootstrap socket', async () => {
    const { client, sockets, statuses, reconnected } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);

    sockets[0].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStatus()).toBe('connecting');
    expect(client.getStartupState()?.state).toBe('starting');

    await vi.advanceTimersByTimeAsync(100);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].result(sockets[1].last('client.hello').id, HELLO_OK);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getStatus()).toBe('connected');
    expect(client.getStartupState()).toBeNull();
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain('disconnected');
    client.dispose();
  });

  it('reports a daemon that fails to start as a failure, not as connected', async () => {
    const { client, sockets, statuses, reconnected } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0, startupFailed());

    expect(client.getStatus()).toBe('disconnected');
    expect(statuses).not.toContain('connected');
    expect(client.getStartupState()).toMatchObject({
      state: 'failed',
      message: 'Daemon startup failed. Check daemon logs.',
      snapshot: { phase: 'failed' },
    });
    expect(client.getRepositoryConnection()).toBeNull();
    expect(reconnected).not.toHaveBeenCalled();

    // Reconnects continue (the sitter may restart or roll back) and the
    // failure stays latched across a failed dial.
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].emit('error', new Error('ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStartupState()?.state).toBe('failed');

    // A rolled-back daemon answers normally: the failure clears.
    await vi.advanceTimersByTimeAsync(100);
    sockets[2].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[2].result(sockets[2].last('client.hello').id, HELLO_OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStatus()).toBe('connected');
    expect(client.getStartupState()).toBeNull();
    expect(reconnected).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('reports a failed snapshot from a status poll as a failure', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);

    await vi.advanceTimersByTimeAsync(1000);
    sockets[0].result(sockets[0].last('system.startupStatus').id, snapshot('failed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getStatus()).toBe('disconnected');
    expect(client.getStartupState()).toMatchObject({
      state: 'failed',
      message: 'Daemon startup failed. Check daemon logs.',
    });
    client.dispose();
  });

  it('refuses ordinary requests while starting without sending them, including ones queued before', async () => {
    const { client, sockets } = make();
    const queued = client.request('workspace.list').catch((e: unknown) => e);
    client.start();
    await helloAnsweredStarting(sockets, 0);

    const queuedError = await queued;
    expect(classifyStartupReply(queuedError)?.kind).toBe('not-ready');

    const refused = await client.request('host.status').catch((e: unknown) => e);
    expect(classifyStartupReply(refused)).toMatchObject({
      kind: 'not-ready',
      snapshot: { phase: 'preparing' },
    });
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    client.dispose();
  });

  it('honors and clamps the daemon retry delay with one poll in flight', async () => {
    const { client, sockets } = make();
    client.start();
    // An out-of-range hint is clamped to the protocol's 30s ceiling.
    const slow = notReady(snapshot('preparing'));
    slow.data.retryAfterMs = 120_000;
    await helloAnsweredStarting(sockets, 0, slow);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(sockets[0].frames.filter((f) => f.method === 'system.startupStatus')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0].frames.filter((f) => f.method === 'system.startupStatus')).toHaveLength(1);

    // While that poll is unanswered no second poll starts.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sockets[0].frames.filter((f) => f.method === 'system.startupStatus')).toHaveLength(1);
    sockets[0].result(
      sockets[0].last('system.startupStatus').id,
      snapshot('indexing', { retryAfterMs: 3000 }),
    );
    await vi.advanceTimersByTimeAsync(2_999);
    expect(sockets[0].frames.filter((f) => f.method === 'system.startupStatus')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0].frames.filter((f) => f.method === 'system.startupStatus')).toHaveLength(2);
    client.dispose();
  });

  it('falls back to a fresh hello when a status poll fails unexpectedly', async () => {
    const { client, sockets, startups } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);

    await vi.advanceTimersByTimeAsync(1000);
    sockets[0].error(sockets[0].last('system.startupStatus').id, {
      code: -32601,
      message: 'Method not found',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(startups.at(-1)).toMatchObject({ state: 'starting', available: false });
    expect(sockets[0].destroyed).toBe(true);
    expect(client.getStatus()).toBe('connecting');

    // Still starting: the fresh hello re-enters startup.
    await vi.advanceTimersByTimeAsync(100);
    await helloAnsweredStarting(sockets, 1, notReady(snapshot('finalizing')));
    expect(client.getStartupState()).toMatchObject({
      state: 'starting',
      available: true,
      snapshot: { phase: 'finalizing' },
    });
    client.dispose();
  });

  it('falls back to a fresh hello when a status poll goes unanswered', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets[0].destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    expect(client.getStatus()).toBe('connecting');
    client.dispose();
  });

  it('clears the starting state when the daemon goes away instead of becoming ready', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);
    sockets[0].close();
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].emit('error', new Error('ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStatus()).toBe('disconnected');
    expect(client.getStartupState()).toBeNull();
    client.dispose();
  });

  it('keeps an ordinary hello error on the legacy connected-without-identity path', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0, { code: -32601, message: 'Method not found' });
    expect(client.getStatus()).toBe('connected');
    expect(client.getStartupState()).toBeNull();
    client.dispose();
  });

  it('stops polling on dispose', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);
    client.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    expect(sockets).toHaveLength(1);
  });

  it('drains retirement while the daemon is starting', async () => {
    const { client, sockets } = make({
      lifecycle: { scope: Symbol('startup-client'), generation: 1 },
    });
    client.start();
    await helloAnsweredStarting(sockets, 0);

    const ticket = client.beginRetirement();
    expect(ticket.isDrained()).toBe(true);
    expect(client.getStatus()).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    expect(sockets).toHaveLength(1);
  });

  it('drains retirement during the ready handoff gap without dialing again', async () => {
    const { client, sockets } = make({
      lifecycle: { scope: Symbol('startup-client'), generation: 1 },
    });
    client.start();
    await helloAnsweredStarting(sockets, 0);
    sockets[0].close();
    await vi.advanceTimersByTimeAsync(0);

    const ticket = client.beginRetirement();
    expect(ticket.isDrained()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
  });

  it('reports connected before announcing that startup ended', async () => {
    const { client, sockets } = make();
    const order: string[] = [];
    client.on('status', (status: ConnectionStatus) => order.push(`status:${status}`));
    client.on('startup', (state: DaemonStartupState | null) =>
      order.push(`startup:${state?.state ?? 'null'}:${client.getStatus()}`),
    );
    client.start();
    await helloAnsweredStarting(sockets, 0);
    sockets[0].close();
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].result(sockets[1].last('client.hello').id, HELLO_OK);
    await vi.advanceTimersByTimeAsync(0);
    // No `connecting` broadcast ever carries a cleared startup state.
    expect(order.filter((e) => e.startsWith('startup:null'))).toEqual(['startup:null:connected']);
    expect(order.indexOf('status:connected')).toBeLessThan(order.indexOf('startup:null:connected'));
    client.dispose();
  });

  it('refuses a hello snapshot read while starting instead of waiting for readiness', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);
    const error = await client.readHelloSnapshot().catch((e: unknown) => e);
    expect(classifyStartupReply(error)?.kind).toBe('not-ready');
    client.dispose();
  });

  it('lets requests after a failed start wait for the next attempt instead of refusing them', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0, startupFailed());
    const pending = client.request('host.status');
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].result(sockets[1].last('client.hello').id, HELLO_OK);
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].result(sockets[1].last('host.status').id, { hostname: 'h' });
    await expect(pending).resolves.toEqual({ hostname: 'h' });
    client.dispose();
  });

  it('shows an authentication rejection instead of a latched startup failure', async () => {
    const { client, sockets } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0, startupFailed());
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].emit('error', new AuthRejectedError(401));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStartupState()).toBeNull();
    client.dispose();
  });

  it('backs off when a starting daemon never serves its status', async () => {
    const { client, sockets } = make({ maxReconnectDelayMs: 400 });
    client.start();
    // Each cycle: hello not-ready, poll unknown method, then a delayed redial
    // that doubles (100, 200, 400ms) instead of a fixed-rate loop.
    for (const [attempt, delay] of [100, 200, 400].entries()) {
      await helloAnsweredStarting(sockets, attempt);
      await vi.advanceTimersByTimeAsync(1000);
      const socket = sockets[attempt];
      socket.error(socket.last('system.startupStatus').id, { code: -32601, message: 'nope' });
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(attempt + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(attempt + 2);
    }
    expect(client.getStatus()).toBe('connecting');
    client.dispose();
  });

  it('republishes clock-only progress at most every 5s but phase changes at once', async () => {
    const { client, sockets, startups } = make();
    client.start();
    await helloAnsweredStarting(sockets, 0);
    const published = () => startups.length;
    const base = published();
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      sockets[0].result(
        sockets[0].last('system.startupStatus').id,
        snapshot('preparing', { elapsedMs: 1200 + i * 1000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(published()).toBe(base);
    await vi.advanceTimersByTimeAsync(1000);
    sockets[0].result(sockets[0].last('system.startupStatus').id, snapshot('finalizing'));
    await vi.advanceTimersByTimeAsync(0);
    expect(published()).toBe(base + 1);
    client.dispose();
  });
});

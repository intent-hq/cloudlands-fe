/** Real service → renderer transport → registered IPC → JsonRpcClient socket boundary. */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ReviewMonitorRow } from '$shared/types/pr-monitor';
import { createPrMonitorTransport } from '$lib/client/live/pr-monitor-transport';
import { createElectronIpcBackendTransport } from '$lib/client/live/electron-ipc-transport';
import {
  subscribePrMonitors,
  cancelPrMonitor,
  flushPrMonitor,
} from '$features/pr-monitor/pr-monitor-service';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { registerPrMonitorHandlers } from './pr-monitor-lifecycle';

const mocks = vi.hoisted(() => ({
  windows: new Map<object, object>(),
  capture: vi.fn(),
  reconnect: undefined as (() => void) | undefined,
}));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => mocks.windows.get(sender) ?? null },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  capturePrMonitorSession: (...args: unknown[]) => mocks.capture(...args),
  onMonitorReconnected: (handler: () => void) => {
    mocks.reconnect = handler;
    return () => {
      mocks.reconnect = undefined;
    };
  },
}));
const channels = IPC_CHANNELS.BACKEND.PR_MONITOR;
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((close) => close());
  mocks.windows.clear();
  vi.clearAllMocks();
});
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function row(id = 'gh'): ReviewMonitorRow {
  return {
    monitorId: id,
    workspaceId: 'ws',
    agentId: 'agent',
    repo: 'Team/Repo',
    prNumber: 42,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-10-09T10:00:00Z',
    updatedAt: '2026-10-09T10:00:00Z',
  };
}
class Socket extends EventEmitter {
  destroyed = false;
  hold = new Set<string>();
  rows: ReviewMonitorRow[] = [row()];
  capability: unknown = 1;
  canonicalClientId: string | undefined;
  helloOverride: Record<string, unknown> | undefined;
  frames: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    const result =
      frame.method === 'client.hello'
        ? {
            clientId: this.canonicalClientId ?? frame.params?.clientId ?? 'desktop',
            ...(frame.params?.connectionRole === undefined
              ? {}
              : { connectionRole: frame.params.connectionRole }),
            server: { capabilities: { reviewMonitoring: this.capability } },
            ...this.helloOverride,
          }
        : frame.method === 'events.subscribe'
          ? { subscriptionId: 'sub' }
          : frame.method === 'prMonitor.list'
            ? { monitors: this.rows }
            : { ok: true };
    if (!this.hold.has(frame.method)) queueMicrotask(() => this.result(frame.id, result));
    return true;
  }
  result(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  notification(type: string, data: unknown, subscriptionId = 'sub') {
    this.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'events.event',
          params: { subscriptionId, event: { type, workspaceId: 'ws', data } },
        }) + '\n',
      ),
    );
  }
  destroy() {
    this.destroyed = true;
  }
}
async function harness(
  capability?: unknown,
  qualified = false,
  prepareRecipient?: (socket: Socket) => void,
) {
  const dedicated: Socket[] = [];
  const dedicatedClients: JsonRpcClient[] = [];
  const sockets = [new Socket(), new Socket()];
  const pool = new Map<string, JsonRpcClient>();
  for (const [index, socket] of sockets.entries()) {
    socket.capability = capability;
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'desktop', capabilities: { browserExec: true } }),
      heartbeatIntervalMs: 0,
    });
    pool.set(index === 0 ? 'A' : 'B', client);
    disposers.push(() => client.dispose());
    client.start();
    socket.emit('connect');
  }
  await settle();
  for (const client of pool.values()) expect(client.getRepositoryConnection()).not.toBeNull();
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const registry = registerPrMonitorHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => pool.get(id),
      recipientVersion: qualified ? 1 : undefined,
      createRecipientClient: (original: JsonRpcClient, hello: Record<string, unknown>) => {
        const socket = new Socket();
        socket.capability = capability;
        dedicated.push(socket);
        prepareRecipient?.(socket);
        const client = new JsonRpcClient({
          config: original.getConfig(),
          socketFactory: () => socket as unknown as Duplex,
          helloParams: () => hello,
          heartbeatIntervalMs: 0,
        });
        dedicatedClients.push(client);
        queueMicrotask(() => socket.emit('connect'));
        return client;
      },
      errorPayload: (error) => ({ code: 'RPC_ERROR', message: String(error) }),
    },
  );
  disposers.push(() => registry.dispose());
  const listeners = new Map<string, { channel: string; handler: (value: unknown) => void }>();
  let serial = 0;
  function makeWindow() {
    const frame = {
      send: (channel: string, value: unknown) => {
        for (const listener of listeners.values())
          if (listener.channel === channel) listener.handler(value);
      },
    };
    const sender = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
    });
    const window = Object.assign(new EventEmitter(), {
      webContents: sender,
      isDestroyed: () => false,
    });
    mocks.windows.set(sender, window);
    stampWindowWithBackend(window as unknown as BrowserWindow, 'A');
    return {
      sender,
      window,
      event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent,
    };
  }
  const original = makeWindow();
  const bridge = {
    reviewMonitoring: qualified ? 1 : undefined,
    on: (channel: string, handler: (value: unknown) => void) => {
      const id = String(++serial);
      listeners.set(id, { channel, handler });
      return id;
    },
    offById: (_channel: string, id: string) => listeners.delete(id),
    invoke: vi.fn((channel: string, payload: unknown) =>
      Promise.resolve(handlers.get(channel)!(original.event, payload)),
    ),
  };
  const capture = createPrMonitorTransport(() => bridge as unknown as Window['electronAPI'], {
    reviewMonitoring: qualified ? 1 : undefined,
  });
  mocks.capture.mockImplementation(capture);
  return {
    sockets,
    pool,
    handlers,
    original,
    bridge,
    capture,
    makeWindow,
    listeners,
    dedicated,
    dedicatedClients,
    registry,
  };
}

describe('bound monitor transport and service', () => {
  it.each([undefined, null, 0, true, '1', 1.5, -1, 1, 2])(
    'observes host capability %s without opting legacy consumers in',
    async (capability) => {
      const h = await harness(capability);
      const session = await h.capture('ws');
      expect(session.support).toBe(
        typeof capability === 'number' && Number.isInteger(capability) && capability >= 1
          ? 'consumer-pending'
          : 'unsupported',
      );
      expect(h.sockets[0].frames[0].params.capabilities).toEqual({ browserExec: true });
      expect(await session.request('prMonitor.list', { workspaceId: 'ws' })).toEqual({
        monitors: [row()],
      });
      await session.release();
      expect(h.listeners.size).toBe(0);
    },
  );
  it('preserves same-name/number GH and GL rows through seeds and controls on the original host', async () => {
    const h = await harness();
    const gl: ReviewMonitorRow = {
      ...row('gl'),
      resource: {
        repository: {
          provider: 'gitlab',
          instanceBaseUrl: 'https://forge.test:8443/install',
          projectPath: 'Team/Repo',
        },
        kind: 'merge-request',
        number: 42,
      },
      monitorAvailability: { state: 'restricted' },
      lastSnapshot: {
        state: 'unknown',
        isDraft: null,
        hasConflicts: null,
        isBehind: null,
        rulesKnown: false,
        checks: {
          total: null,
          passed: null,
          failed: null,
          pending: null,
          failingRequired: null,
          pendingRequired: null,
          requiredKnown: false,
        },
        approvals: { decision: null, have: null, changesRequested: null },
        threads: {},
        availability: {
          checks: 'unknown',
          approvals: 'restricted',
          policy: 'unavailable',
          discussions: 'unknown',
        },
      },
    };
    h.sockets[0].rows = [row(), gl];
    const seen: ReviewMonitorRow[][] = [];
    const lease = subscribePrMonitors('ws', (rows) => seen.push(rows));
    disposers.push(lease.dispose);
    await settle();
    expect(seen.at(-1)).toMatchObject([row(), gl]);
    const origin = seen.at(-1)![1].origin!;
    expect(origin.backendId).toBe('A');
    await flushPrMonitor('ws', 'gl', true, origin);
    await cancelPrMonitor('ws', 'gh', origin);
    expect(h.sockets[0].frames.slice(-2).map(({ method, params }) => ({ method, params }))).toEqual(
      [
        { method: 'prMonitor.flush', params: { workspaceId: 'ws', monitorId: 'gl', check: true } },
        { method: 'prMonitor.cancel', params: { workspaceId: 'ws', monitorId: 'gh' } },
      ],
    );
    expect(h.sockets[1].frames).toHaveLength(1);
    h.sockets[0].notification('prMonitor:changed', {
      workspaceId: 'ws',
      monitorId: 'gl',
      resource: gl.resource,
      monitorAvailability: { state: 'backoff', retryAt: '2026-10-09T16:00:00Z' },
      changes: [],
    });
    expect(seen.at(-1)![1].monitorAvailability?.state).toBe('backoff');
    expect(seen.at(-1)![1].lastSnapshot?.checks.total).toBeNull();
  });
  it('suppresses late seeds/events and old controls after A→B→A document changes', async () => {
    const h = await harness();
    h.sockets[0].hold.add('prMonitor.list');
    const seen: ReviewMonitorRow[][] = [];
    const statuses: string[] = [];
    const lease = subscribePrMonitors(
      'ws',
      (rows) => seen.push(rows),
      (status) => statuses.push(status),
    );
    disposers.push(lease.dispose);
    await settle();
    const pending = h.sockets[0].frames.find((frame) => frame.method === 'prMonitor.list')!;
    const captured = await h.capture('ws');
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'B');
    expect(statuses).toContain('reconnecting');
    mocks.reconnect?.();
    await settle();
    expect(seen.at(-1)![0].origin?.backendId).toBe('B');
    h.sockets[0].result(pending.id, { monitors: [row('late-A')] });
    h.sockets[0].notification('prMonitor:cancelled', { monitorId: 'gh' });
    await settle();
    expect(seen.at(-1)![0].origin?.backendId).toBe('B');
    await expect(cancelPrMonitor('ws', 'gh', captured.origin)).rejects.toThrow();
    await expect(
      captured.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'gh', check: true }),
    ).rejects.toThrow();
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'A');
    await expect(
      captured.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'gh' }),
    ).rejects.toThrow();
    expect(
      h.sockets
        .flatMap((socket) => socket.frames)
        .filter((frame) => ['prMonitor.cancel', 'prMonitor.flush'].includes(frame.method)),
    ).toEqual([]);
    await captured.release();
  });
  it('refuses foreign documents/workspaces and arbitrary RPCs before any daemon frame', async () => {
    const h = await harness();
    const session = await h.capture('ws');
    const foreign = h.makeWindow();
    const count = h.sockets[0].frames.length;
    const payload = {
      id: session.origin.sessionId,
      workspaceId: 'ws',
      method: 'prMonitor.cancel',
      params: { workspaceId: 'ws', monitorId: 'gh' },
    };
    expect(await h.handlers.get(channels.REQUEST)!(foreign.event, payload)).toMatchObject({
      ok: false,
    });
    expect(
      await h.handlers.get(channels.REQUEST)!(h.original.event, {
        ...payload,
        workspaceId: 'other',
      }),
    ).toMatchObject({ ok: false });
    expect(
      await h.handlers.get(channels.REQUEST)!(h.original.event, {
        ...payload,
        method: 'host.exec',
      }),
    ).toMatchObject({ ok: false });
    expect(h.sockets[0].frames).toHaveLength(count);
    await session.release();
  });
  it('retires a session on reconnect of the same client and rejects late subscribe acknowledgments', async () => {
    const h = await harness();
    const socket = h.sockets[0];
    socket.hold.add('events.subscribe');
    const session = await h.capture('ws');
    const retired = vi.fn();
    session.onRetired(retired);
    const pending = session.request('events.subscribe', {
      workspaceId: 'ws',
      eventTypes: ['prMonitor:*'],
    });
    const assertion = expect(pending).rejects.toThrow();
    const frame = socket.frames.at(-1)!;
    h.pool.get('A')!.dispose();
    socket.result(frame.id, { subscriptionId: 'late' });
    await assertion;
    expect(retired).toHaveBeenCalledOnce();
    await session.release();
  });
});

// No mock-router fallback may manufacture an origin when the real preload is absent.
it('rejects monitor capture before IPC when no real preload bridge exists', async () => {
  await expect(createPrMonitorTransport(() => undefined)('ws')).rejects.toMatchObject({
    code: 'PR_MONITOR_SESSION_RETIRED',
  });
});

describe('qualified native document receipt', () => {
  it('isolates its socket and closes only the original document connection on restamp', async () => {
    const h = await harness(1, true);
    const original = h.pool.get('A')!.getRepositoryConnection();
    const first = await h.capture('ws');
    const second = await h.capture('other-workspace');
    expect(first.support).toBe('supported');
    expect(second.support).toBe('supported');
    expect(h.dedicated).toHaveLength(1);
    expect(h.dedicated[0].frames[0].params).toEqual({
      clientId: 'desktop',
      connectionRole: 'review-monitor',
      capabilities: { reviewMonitoring: 1 },
    });
    await first.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' });
    expect(h.sockets[0].frames.map((x) => x.method)).not.toContain('prMonitor.cancel');
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'B');
    expect(h.dedicated[0].destroyed).toBe(true);
    expect(h.sockets[0].destroyed).toBe(false);
    expect(h.pool.get('A')!.getRepositoryConnection()).toBe(original);
    await expect(
      first.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
  });
  it('does not upgrade a second document on the pooled connection', async () => {
    const h = await harness(1, true);
    await h.capture('ws');
    const other = h.makeWindow();
    const result = (await h.handlers.get(channels.CAPTURE)!(other.event, {
      workspaceId: 'ws',
    })) as any;
    expect(result.result.support).toBe('consumer-pending');
    expect(h.dedicated).toHaveLength(1);
    const control = await h.handlers.get(channels.REQUEST)!(other.event, {
      id: result.result.origin.sessionId,
      workspaceId: 'ws',
      method: 'prMonitor.cancel',
      params: { workspaceId: 'ws', monitorId: 'm' },
    });
    expect(control).toEqual({ ok: true, result: { ok: true } });
    expect(h.sockets[0].frames.at(-1)?.method).toBe('prMonitor.cancel');
  });
});

describe('native recipient withdrawal', () => {
  it('retires a capable document receipt when the same document withdraws support', async () => {
    const h = await harness(1, true);
    const original = await h.capture('ws');
    const result = (await h.handlers.get(channels.CAPTURE)!(h.original.event, {
      workspaceId: 'ws',
      reviewMonitoring: 0,
    })) as any;
    expect(result.result.support).toBe('consumer-pending');
    expect(h.dedicated[0].destroyed).toBe(true);
    await expect(
      original.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
    expect(h.sockets[0].destroyed).toBe(false);
  });
});

describe('native document history route', () => {
  it('uses the monitor document socket for conversation pages and refuses late history after retirement', async () => {
    const h = await harness(1, true);
    await h.capture('ws');
    const params = { agentId: 'agent', workspaceId: 'ws', projection: 'slim', nextToken: 'next' };
    expect(
      await h.registry.requestHistory(h.original.event, 'agent.getConversation', params, 1),
    ).toEqual({ ok: true, result: { ok: true } });
    expect(h.dedicated[0].frames.at(-1)).toMatchObject({ method: 'agent.getConversation', params });
    expect(h.sockets[0].frames.map((f) => f.method)).not.toContain('agent.getConversation');
    h.dedicated[0].hold.add('agent.getMessageBlock');
    const pending = h.registry.requestHistory(
      h.original.event,
      'agent.getMessageBlock',
      { agentId: 'agent', messageId: 'm', blockId: 'b' },
      1,
    );
    await settle();
    const frame = h.dedicated[0].frames.at(-1)!;
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'B');
    h.dedicated[0].result(frame.id, { block: { text: 'private old result' } });
    expect(await pending).toMatchObject({ ok: false });
    expect(h.sockets[1].frames.map((f) => f.method)).not.toContain('agent.getMessageBlock');
  });
  it('does not upgrade legacy history or agent summary consumers', async () => {
    const h = await harness(1, true);
    await h.capture('ws');
    const other = h.makeWindow();
    expect(
      h.registry.requestHistory(
        other.event,
        'agent.getConversation',
        { agentId: 'agent' },
        undefined,
      ),
    ).toBeUndefined();
    expect(
      h.registry.requestHistory(h.original.event, 'agent.getSession', { agentId: 'agent' }, 1),
    ).toBeUndefined();
    expect(h.dedicated).toHaveLength(1);
  });
});

describe('native document receipt lifetimes', () => {
  it.each(['timeout', 'malformed', 'error', 'navigation', 'source-retired'])(
    'rejects pending capture on %s without sending a monitor operation',
    async (failure) => {
      vi.useFakeTimers();
      try {
        const h = await harness(1, true, (socket) => socket.hold.add('client.hello'));
        const pending = h.capture('ws');
        const rejected = expect(pending).rejects.toThrow();
        await settle();
        const socket = h.dedicated[0];
        const hello = socket.frames[0];
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5001);
        if (failure === 'malformed') socket.result(hello.id, { clientId: 7 });
        if (failure === 'error')
          socket.emit(
            'data',
            Buffer.from(
              JSON.stringify({ id: hello.id, error: { code: -1, message: 'no receipt' } }) + '\n',
            ),
          );
        if (failure === 'navigation')
          h.original.sender.emit('did-start-navigation', {}, 'https://replacement', false, true);
        if (failure === 'source-retired') h.pool.get('A')!.dispose();
        await settle();
        if (failure === 'error') await vi.advanceTimersByTimeAsync(5001);
        await rejected;
        socket.result(hello.id, {
          clientId: 'late',
          server: { capabilities: { reviewMonitoring: 1 } },
        });
        expect(socket.destroyed).toBe(true);
        expect(socket.frames.map((f) => f.method)).toEqual(['client.hello']);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('keeps capable documents independent through A to B to A and original pool retirement', async () => {
    const h = await harness(1, true);
    const first = await h.capture('ws');
    const other = h.makeWindow();
    const second = (await h.handlers.get(channels.CAPTURE)!(other.event, {
      workspaceId: 'ws',
      reviewMonitoring: 1,
    })) as any;
    expect(h.dedicated).toHaveLength(2);
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'B');
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'A');
    const replacement = await h.capture('ws');
    expect(replacement.origin.sessionId).not.toBe(first.origin.sessionId);
    expect(h.dedicated[0].destroyed).toBe(true);
    expect(h.dedicated[1].destroyed).toBe(false);
    expect(
      await h.handlers.get(channels.REQUEST)!(other.event, {
        id: second.result.origin.sessionId,
        workspaceId: 'ws',
        method: 'prMonitor.cancel',
        params: { workspaceId: 'ws', monitorId: 'm' },
      }),
    ).toMatchObject({ ok: true });
    await expect(
      first.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
    h.pool.get('A')!.dispose();
    expect(h.dedicated.every((socket) => socket.destroyed)).toBe(true);
    await expect(
      replacement.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
  });
});

describe('native history frame withdrawal', () => {
  it('does not let a child frame withdraw its parent document receipt', async () => {
    const h = await harness(1, true);
    const session = await h.capture('ws');
    await h.registry.requestHistory(
      { ...h.original.event, senderFrame: {} } as IpcMainInvokeEvent,
      'agent.getConversation',
      { agentId: 'agent' },
      undefined,
    );
    expect(h.dedicated[0].destroyed).toBe(false);
    await expect(session.request('prMonitor.list', { workspaceId: 'ws' })).resolves.toMatchObject({
      monitors: [row()],
    });
  });
});

describe('native acknowledged attachment contract', () => {
  it('does not restore disposed monitor or chat consumers when the document reconnects', async () => {
    vi.useFakeTimers();
    try {
      const h = await harness(1, true);
      const previous = window.electronAPI;
      window.electronAPI = h.bridge as unknown as Window['electronAPI'];
      disposers.push(() => {
        window.electronAPI = previous;
      });
      const transport = createElectronIpcBackendTransport({ reviewMonitoring: 1 });
      const offMonitor = transport.onMonitorReconnected(() => mocks.reconnect?.());
      const chat = vi.fn();
      const offChat = transport.onReconnected(chat);
      const subscription = subscribePrMonitors('ws', () => {});
      await settle();
      h.dedicated[0].destroyed = true;
      h.dedicated[0].emit('close');
      subscription.dispose();
      offMonitor();
      offChat();
      await vi.advanceTimersByTimeAsync(1001);
      expect(h.dedicated).toHaveLength(2);
      expect(h.dedicated[1].frames.map((frame) => frame.method)).toEqual(['client.hello']);
      expect(chat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['dispose', 'source-retired', 'navigation', 'withdrawal'])(
    'does not resurrect attachment subscriptions after recovery %s',
    async (reason) => {
      vi.useFakeTimers();
      try {
        const h = await harness(1, true);
        const old = await h.capture('ws');
        const ready = vi.fn();
        h.bridge.on(channels.READY, ready);
        h.dedicated[0].destroyed = true;
        h.dedicated[0].emit('close');
        if (reason === 'dispose') h.registry.dispose();
        if (reason === 'source-retired') h.pool.get('A')!.dispose();
        if (reason === 'navigation')
          stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'B');
        if (reason === 'withdrawal')
          await h.handlers.get(channels.CAPTURE)!(h.original.event, { workspaceId: 'ws' });
        await vi.advanceTimersByTimeAsync(31_000);
        expect(h.dedicated).toHaveLength(1);
        expect(ready).not.toHaveBeenCalled();
        await expect(
          old.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm', check: true }),
        ).rejects.toThrow();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('withholds recovery readiness after a failed echo and retries only on the original source', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const h = await harness(1, true, (socket) => {
        if (++attempts === 2) socket.helloOverride = { connectionRole: 'ordinary' };
      });
      const old = await h.capture('ws');
      const ready = vi.fn();
      h.bridge.on(channels.READY, ready);
      h.dedicated[0].destroyed = true;
      h.dedicated[0].emit('close');
      await vi.advanceTimersByTimeAsync(1001);
      expect(h.dedicated).toHaveLength(2);
      expect(h.dedicated[1].destroyed).toBe(true);
      expect(ready).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2001);
      expect(h.dedicated).toHaveLength(3);
      expect(ready).toHaveBeenCalledOnce();
      expect(
        h.dedicated
          .flatMap((socket) => socket.frames)
          .every((frame) => frame.method === 'client.hello'),
      ).toBe(true);
      await expect(
        old.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
      ).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it('recovers the monitor subscription when only its attachment socket closes', async () => {
    vi.useFakeTimers();
    try {
      const h = await harness(1, true);
      const updates: ReviewMonitorRow[][] = [];
      const previous = window.electronAPI;
      window.electronAPI = h.bridge as unknown as Window['electronAPI'];
      disposers.push(() => {
        window.electronAPI = previous;
      });
      const transport = createElectronIpcBackendTransport({ reviewMonitoring: 1 });
      disposers.push(transport.onMonitorReconnected(() => mocks.reconnect?.()));
      const subscription = subscribePrMonitors('ws', (rows) => updates.push(rows));
      disposers.push(() => subscription.dispose());
      await settle();
      expect(updates.at(-1)).toHaveLength(1);
      const source = h.pool.get('A')!.getRepositoryConnection();
      h.dedicated[0].destroyed = true;
      h.dedicated[0].emit('close');
      await settle();
      expect(updates.at(-1)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1001);
      await settle();
      expect(h.pool.get('A')!.getRepositoryConnection()).toBe(source);
      expect(h.dedicated).toHaveLength(2);
      expect(updates.at(-1)).toHaveLength(1);
      expect(h.sockets[0].frames.map((frame) => frame.method)).toEqual(['client.hello']);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retires attachments and pending history before an ordinary source rehello is acknowledged', async () => {
    const h = await harness(1, true);
    const session = await h.capture('ws');
    const retired = vi.fn();
    session.onRetired(retired);
    h.dedicated[0].hold.add('agent.getConversation');
    const history = h.registry.requestHistory(
      h.original.event,
      'agent.getConversation',
      { agentId: 'agent' },
      1,
    );
    await settle();
    const historyFrame = h.dedicated[0].frames.at(-1)!;
    h.sockets[0].hold.add('client.hello');
    const rehello = h.pool.get('A')!.request('client.hello');
    await settle();
    expect(retired).toHaveBeenCalledOnce();
    expect(h.dedicated[0].destroyed).toBe(true);
    await expect(h.capture('ws')).rejects.toThrow();
    h.dedicated[0].result(historyFrame.id, { messages: ['late-private-history'] });
    expect(await history).toMatchObject({ ok: false });
    const hello = h.sockets[0].frames.at(-1)!;
    h.sockets[0].result(hello.id, {
      clientId: 'desktop',
      server: { capabilities: { reviewMonitoring: 1 } },
    });
    await rehello;
    const replacement = await h.capture('ws');
    expect(replacement.origin.sessionId).not.toBe(session.origin.sessionId);
    await expect(
      session.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
    await replacement.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' });
    expect(h.dedicated[1].frames.at(-1)?.method).toBe('prMonitor.cancel');
    expect(h.sockets[0].frames.every((frame) => frame.method === 'client.hello')).toBe(true);
  });
  it('closes a rehelloing attachment without retiring the source or another document', async () => {
    const h = await harness(1, true);
    const session = await h.capture('ws');
    const other = h.makeWindow();
    await h.handlers.get(channels.CAPTURE)!(other.event, {
      workspaceId: 'ws',
      reviewMonitoring: 1,
    });
    const source = h.pool.get('A')!.getRepositoryConnection();
    await expect(
      h.dedicatedClients[0].request('client.hello', { connectionRole: 'ordinary' }),
    ).rejects.toThrow();
    expect(h.dedicated[0].destroyed).toBe(true);
    expect(h.dedicated[1].destroyed).toBe(false);
    expect(h.pool.get('A')!.getRepositoryConnection()).toBe(source);
    expect(h.dedicated[0].frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(
      1,
    );
    await expect(
      session.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
  });
  it('uses canonical original acknowledgement identity and the explicit attachment role only', async () => {
    const h = await harness(1, true);
    h.sockets[0].canonicalClientId = 'principal:canonical-desktop';
    await h.pool.get('A')!.request('client.hello');
    await h.capture('ws');
    expect(h.dedicated[0].frames[0].params).toEqual({
      clientId: 'principal:canonical-desktop',
      connectionRole: 'review-monitor',
      capabilities: { reviewMonitoring: 1 },
    });
    expect(h.sockets[0].frames.at(-1)?.params).toEqual({
      clientId: 'desktop',
      capabilities: { browserExec: true },
    });
  });
  it.each([undefined, null, 0, -1, false, '1', 1.5])(
    'does not send an attachment hello to old/unsupported host %s',
    async (capability) => {
      const h = await harness(capability, true);
      expect((await h.capture('ws')).support).toBe('unsupported');
      expect(h.dedicated).toHaveLength(0);
      expect(
        h.registry.requestHistory(
          h.original.event,
          'agent.getConversation',
          { agentId: 'agent' },
          1,
        ),
      ).toBeUndefined();
    },
  );
  it.each([
    { connectionRole: undefined },
    { connectionRole: null },
    { connectionRole: 'ordinary' },
    { connectionRole: 7 },
    { clientId: 'other' },
    { clientId: '' },
  ])('refuses attachment echo %j without fallback', async (override) => {
    const h = await harness(1, true, (socket) => {
      socket.helloOverride = override;
    });
    await expect(h.capture('ws')).rejects.toThrow();
    expect(h.dedicated[0].destroyed).toBe(true);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });
});

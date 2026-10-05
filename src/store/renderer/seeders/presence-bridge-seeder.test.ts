/**
 * Wire-contract tests for the bridge-less `presence:report` fallback.
 *
 * Asserts the handler forwards each report as `presence.update`, degrades an
 * unsupported daemon to a `null` typing source, and never lets an older report
 * land after a newer one even though the browser transport answers concurrent
 * requests out of order.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { PresenceReportParams, PresenceReportResult } from '$shared/types/presence';

const mockedRequest = vi.mocked(backendRequest);

function report(params: PresenceReportParams): Promise<PresenceReportResult> {
  return mockInvoke<PresenceReportResult>(IPC_CHANNELS.PRESENCE.REPORT, params);
}

const focusA: PresenceReportParams = { focus: [{ workspaceId: 'ws-a' }], typing: null };
const focusB: PresenceReportParams = { focus: [{ workspaceId: 'ws-b' }], typing: null };

describe('presence-bridge-seeder', () => {
  beforeAll(async () => {
    await import('./presence-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a report as presence.update and returns the connection typing source', async () => {
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-1' });

    await expect(report(focusA)).resolves.toEqual({ typingSource: 'ts-1' });
    expect(mockedRequest).toHaveBeenCalledWith('presence.update', focusA);
  });

  it('answers a null typing source when the daemon has no presence method', async () => {
    mockedRequest.mockRejectedValueOnce({ code: 'METHOD_NOT_FOUND' });

    await expect(report(focusA)).resolves.toEqual({ typingSource: null });
  });

  it('holds a newer report until the older one settles so a stale update cannot land last', async () => {
    let settleFirst!: (value: { typingSource: string }) => void;
    mockedRequest.mockImplementationOnce(
      () => new Promise((resolve) => (settleFirst = resolve)) as never,
    );
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-2' });

    const first = report(focusA);
    const second = report(focusB);
    await Promise.resolve();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenLastCalledWith('presence.update', focusA);

    settleFirst({ typingSource: 'ts-1' });
    await expect(first).resolves.toEqual({ typingSource: 'ts-1' });
    await expect(second).resolves.toEqual({ typingSource: 'ts-2' });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenLastCalledWith('presence.update', focusB);
  });

  it('keeps forwarding after a failed report', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-3' });

    await expect(report(focusA)).rejects.toThrow('boom');
    await expect(report(focusB)).resolves.toEqual({ typingSource: 'ts-3' });
  });
});

/** Exercise the existing serialized bridge with the real browser transport underneath. */
describe('presence bridge connection readiness', () => {
  let transport: BrowserWebSocketTransport;
  let sockets: Array<
    BrowserWebSocketLike & { frames: Array<{ id: number; method: string; params?: unknown }> }
  >;
  const clear: PresenceReportParams = { focus: [], typing: null };

  async function flush() {
    // Each bridge report joins its predecessor before entering the transport.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  function setup() {
    sockets = [];
    transport = new BrowserWebSocketTransport({
      url: 'ws://127.0.0.1:9100/rpc',
      webSocketFactory: () => {
        const frames: Array<{ id: number; method: string; params?: unknown }> = [];
        const socket = {
          frames,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send: (data: string) => frames.push(JSON.parse(data)),
          close: () => undefined,
        };
        sockets.push(socket);
        return socket;
      },
    });
    mockedRequest.mockImplementation(transport.request.bind(transport));
  }

  function reply(result: unknown, error?: { code: number; message: string }) {
    const socket = sockets[sockets.length - 1];
    socket.onmessage?.({
      data: JSON.stringify({ jsonrpc: '2.0', id: socket.frames.at(-1)!.id, result, error }),
    });
  }

  afterEach(() => {
    transport?.dispose();
    mockedRequest.mockReset();
    vi.useRealTimers();
  });

  it('keeps queued focus, switches and clears serialized behind the cold hello', async () => {
    setup();
    const a = report(focusA);
    const b = report(focusB);
    const cleared = report(clear);
    await flush();
    sockets[0].onopen?.();
    await flush();
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    reply({ clientId: 'browser-queue', server: { capabilities: {} } });
    await flush();
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello', 'presence.update']);
    expect(sockets[0].frames.at(-1)?.params).toEqual(focusA);
    reply({ typingSource: 'ts-queue' });
    await a;
    await flush();
    expect(sockets[0].frames.at(-1)?.params).toEqual(focusB);
    reply({ typingSource: 'ts-queue' });
    await b;
    await flush();
    expect(sockets[0].frames.at(-1)?.params).toEqual(clear);
    reply({ typingSource: 'ts-queue' });
    await expect(cleared).resolves.toEqual({ typingSource: 'ts-queue' });
    expect(
      sockets[0].frames.filter((f) => f.method === 'presence.update').map((f) => f.params),
    ).toEqual([focusA, focusB, clear]);
  });

  it('drops an interrupted report and sends its newer clear only after the replacement hello', async () => {
    vi.useFakeTimers();
    setup();
    const first = report(focusA);
    const rejected = expect(first).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    const cleared = report(clear);
    await flush();
    sockets[0].onopen?.();
    const staleMessage = sockets[0].onmessage!;
    const staleId = sockets[0].frames[0].id;
    sockets[0].onclose?.();
    await rejected;
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1].onopen?.();
    staleMessage({
      data: JSON.stringify({ jsonrpc: '2.0', id: staleId, result: { clientId: 'obsolete' } }),
    });
    await flush();
    expect(sockets[1].frames.map((f) => f.method)).toEqual(['client.hello']);
    reply({ clientId: 'replacement', server: { capabilities: {} } });
    await flush();
    expect(sockets[1].frames.at(-1)).toMatchObject({ method: 'presence.update', params: clear });
    reply({ typingSource: 'ts-clear' });
    await expect(cleared).resolves.toEqual({ typingSource: 'ts-clear' });
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('keeps method-not-found compatibility when hello itself is unsupported', async () => {
    setup();
    const first = report(focusA);
    await flush();
    sockets[0].onopen?.();
    reply(undefined, { code: -32601, message: 'Method not found' });
    await expect(first).resolves.toEqual({ typingSource: null });
    await expect(report(clear)).resolves.toEqual({ typingSource: null });
    expect(sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });
});

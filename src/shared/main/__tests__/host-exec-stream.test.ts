import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-contract tests for host-exec-stream.ts.
 *
 * Per PROTOCOL.md §5.14, streaming arbitrary execution is delegated to the
 * daemon via `host.execStream` (with `host.execStream.write` /
 * `host.execStream.cancel` follow-ups and `host:exec:{stdout,stderr,exit}`
 * events). These tests assert the exact requests sent on the wire and feed
 * back PROTOCOL-shaped mock frames through a captured notification listener.
 */

type Listener = (n: { method: string; params?: unknown }) => void;

const { mockRequest, mockOn, mockOff, loggerSpies, captureListener } = vi.hoisted(() => {
  const state: { listener: Listener | null } = { listener: null };
  return {
    mockRequest: vi.fn(),
    mockOn: vi.fn((event: string, cb: Listener) => {
      if (event === 'notification') state.listener = cb;
    }),
    mockOff: vi.fn((event: string, _cb: Listener) => {
      if (event === 'notification') state.listener = null;
    }),
    loggerSpies: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    captureListener: () => state.listener,
  };
});

vi.mock('../../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest, on: mockOn, off: mockOff }),
}));

vi.mock('../../logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

import {
  cancelInflightHostExecStreamsForBackendSwitch,
  hostExecStream,
} from '../host-exec-stream';

/** Push a PROTOCOL-shaped `events.event` frame through the captured listener. */
function emit(type: string, data: Record<string, unknown>): void {
  const listener = captureListener();
  if (!listener) throw new Error('notification listener not registered');
  listener({ method: 'events.event', params: { event: { type, data } } });
}

/** Base64-encode a UTF-8 string for `host:exec:{stdout,stderr}.chunk`. */
function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

describe('hostExecStream', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockOn.mockReset();
    mockOff.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.error.mockReset();
  });

  it('subscribes to exec events, sends host.execStream with full params, and streams stdout/exit', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-1' }) // events.subscribe
      .mockResolvedValueOnce({ requestId: 'req-1' }); // host.execStream

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const handle = await hostExecStream('auggie', {
      args: ['--print'],
      cwd: '/ws/repo',
      workspaceId: 'ws-1',
      env: { PYTHONUNBUFFERED: '1' },
      timeoutMs: 60000,
      stdin: 'hello',
      onStdout: (c) => stdout.push(c),
      onStderr: (c) => stderr.push(c),
    });

    expect(handle.requestId).toBe('req-1');
    expect(mockRequest).toHaveBeenNthCalledWith(1, 'events.subscribe', {
      eventTypes: ['host:exec:stdout', 'host:exec:stderr', 'host:exec:exit'],
    });
    expect(mockRequest).toHaveBeenNthCalledWith(2, 'host.execStream', {
      command: 'auggie',
      args: ['--print'],
      cwd: '/ws/repo',
      env: { PYTHONUNBUFFERED: '1' },
      timeoutMs: 60000,
      workspaceId: 'ws-1',
      stdin: 'hello',
    });

    // Mock daemon-side streamed frames.
    emit('host:exec:stdout', { requestId: 'req-1', chunk: b64('chunk-a\n') });
    emit('host:exec:stderr', { requestId: 'req-1', chunk: b64('warn\n') });
    // Cross-talk frame with a different requestId must be ignored.
    emit('host:exec:stdout', { requestId: 'other', chunk: b64('nope') });

    // Prime the unsubscribe RPC so cleanup doesn't reject.
    mockRequest.mockResolvedValueOnce({ ok: true });
    emit('host:exec:exit', { requestId: 'req-1', ok: true, exitCode: 0 });

    const result = await handle.done;
    expect(result).toEqual({ ok: true, exitCode: 0 });
    expect(Buffer.concat(stdout).toString('utf8')).toBe('chunk-a\n');
    expect(Buffer.concat(stderr).toString('utf8')).toBe('warn\n');
    expect(mockOff).toHaveBeenCalledWith('notification', expect.any(Function));
    expect(mockRequest).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'sub-1',
    });
  });

  it('forwards writeStdin, writeStdinBase64, endStdin, and cancel with the correct requestId', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-2' })
      .mockResolvedValueOnce({ requestId: 'req-2' });

    const handle = await hostExecStream('auggie');

    mockRequest.mockResolvedValueOnce({ ok: true });
    await handle.writeStdin('more input');
    expect(mockRequest).toHaveBeenLastCalledWith('host.execStream.write', {
      requestId: 'req-2',
      stdin: 'more input',
    });

    mockRequest.mockResolvedValueOnce({ ok: true });
    await handle.writeStdinBase64(b64('binary'));
    expect(mockRequest).toHaveBeenLastCalledWith('host.execStream.write', {
      requestId: 'req-2',
      stdinBase64: b64('binary'),
    });

    mockRequest.mockResolvedValueOnce({ ok: true });
    await handle.endStdin();
    expect(mockRequest).toHaveBeenLastCalledWith('host.execStream.write', {
      requestId: 'req-2',
      eof: true,
    });

    mockRequest.mockResolvedValueOnce({ ok: true, cancelled: true });
    const cancelResult = await handle.cancel();
    expect(mockRequest).toHaveBeenLastCalledWith('host.execStream.cancel', {
      requestId: 'req-2',
    });
    expect(cancelResult).toEqual({ ok: true, cancelled: true });

    // Terminate the stream so unhandled `done` doesn't leak between tests.
    mockRequest.mockResolvedValueOnce({ ok: true });
    emit('host:exec:exit', { requestId: 'req-2', ok: true, exitCode: 0 });
    await handle.done;
  });

  it('rejects done and cancels the daemon-side stream when the abort signal fires', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-3' })
      .mockResolvedValueOnce({ requestId: 'req-3' });

    const controller = new AbortController();
    const handle = await hostExecStream('auggie', { signal: controller.signal });

    mockRequest
      .mockResolvedValueOnce({ ok: true, cancelled: true }) // host.execStream.cancel
      .mockResolvedValueOnce({ ok: true }); // events.unsubscribe cleanup

    controller.abort();
    await expect(handle.done).rejects.toThrow(/aborted/);
    expect(mockRequest).toHaveBeenCalledWith('host.execStream.cancel', {
      requestId: 'req-3',
    });
  });

  it('rejects the caller when host.execStream itself fails (honest degradation)', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-4' })
      .mockRejectedValueOnce(new Error('transport down'));

    // Cleanup unsubscribe (fire-and-forget) — prime one more resolved response.
    mockRequest.mockResolvedValueOnce({ ok: true });

    await expect(hostExecStream('auggie')).rejects.toThrow('transport down');
    expect(mockRequest).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'sub-4',
    });
  });

  it('rejects immediately when events.subscribe fails (no host.execStream sent)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('subscribe failed'));

    await expect(hostExecStream('auggie')).rejects.toThrow('subscribe failed');
    // Only the failed events.subscribe should have hit the wire.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['host:exec:stdout', 'host:exec:stderr', 'host:exec:exit'],
    });
  });

  it('terminates an in-flight stream with a cancelled-by-backend-switch frame on a backend switch', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-switch' }) // events.subscribe
      .mockResolvedValueOnce({ requestId: 'req-switch' }); // host.execStream

    const handle = await hostExecStream('auggie');

    // A switch fires while the stream is live: (a) best-effort cancel to the old
    // daemon, (b) unsubscribe cleanup — prime both so the sweep doesn't reject.
    mockRequest
      .mockResolvedValueOnce({ ok: true, cancelled: true }) // host.execStream.cancel
      .mockResolvedValueOnce({ ok: true }); // events.unsubscribe cleanup

    await cancelInflightHostExecStreamsForBackendSwitch();

    // The consumer resolves deterministically instead of hanging on frames that
    // can never arrive on the about-to-be-disposed client.
    const result = await handle.done;
    expect(result).toEqual({ ok: false, cancelled: true, cancelledByBackendSwitch: true });

    // Best-effort cancel sent to the old daemon before it is disposed.
    expect(mockRequest).toHaveBeenCalledWith('host.execStream.cancel', {
      requestId: 'req-switch',
    });
    // No listener remains attached to the (soon-disposed) client.
    expect(mockOff).toHaveBeenCalledWith('notification', expect.any(Function));

    // Registry emptied: a second sweep is a no-op (no further wire traffic).
    mockRequest.mockClear();
    await cancelInflightHostExecStreamsForBackendSwitch();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is streaming at switch time', async () => {
    await expect(cancelInflightHostExecStreamsForBackendSwitch()).resolves.toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('propagates timedOut and cancelled flags on the terminal exit frame', async () => {
    mockRequest
      .mockResolvedValueOnce({ subscriptionId: 'sub-5' })
      .mockResolvedValueOnce({ requestId: 'req-5' });

    const handle = await hostExecStream('auggie', { timeoutMs: 10 });

    mockRequest.mockResolvedValueOnce({ ok: true });
    emit('host:exec:exit', {
      requestId: 'req-5',
      ok: false,
      exitCode: 124,
      timedOut: true,
    });

    const result = await handle.done;
    expect(result).toEqual({
      ok: false,
      exitCode: 124,
      timedOut: true,
    });
  });
});

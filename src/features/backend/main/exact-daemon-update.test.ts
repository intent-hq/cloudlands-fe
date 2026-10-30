// protocol-version-ok-file: fixed release identifiers are update test fixtures
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateDaemonToPin } from './exact-daemon-update';
import { JsonRpcError } from './json-rpc-errors';

function client() {
  return {
    getStatus: vi.fn(() => 'connected' as const),
    request: vi.fn(),
  };
}

afterEach(() => vi.useRealTimers());

function startupError(
  code: 'daemon-not-ready' | 'daemon-startup-failed',
  retryAfterMs?: number,
): JsonRpcError {
  const failed = code === 'daemon-startup-failed';
  return new JsonRpcError({
    code: -32012,
    message: failed ? 'Daemon startup failed' : 'Daemon not ready',
    data: {
      code,
      retryable: !failed,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      startup: {
        startupStatus: 1,
        daemonVersion: '1.2.0',
        attemptId: 'boot-a',
        phase: failed ? 'failed' : 'indexing',
        elapsedMs: 10,
        phaseElapsedMs: 10,
        progressAgeMs: 10,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
    },
  });
}

function acceptedUpdate() {
  const rpc = client();
  rpc.request
    .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
    .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' });
  return rpc;
}

describe('exact daemon updates', () => {
  it.each(['1.2.0', 'v1.2.0', '1.2.0+build.7', 'v1.2.0+build.7'])(
    'sends the precise target and confirms equivalent reported version %s',
    async (version) => {
      const rpc = client();
      rpc.request
        .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
        .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
        .mockResolvedValueOnce({ version, exactUpdateSupported: true });
      const mark = vi.fn();
      await expect(updateDaemonToPin(rpc, '1.2.0', mark)).resolves.toEqual({ ok: true });
      expect(rpc.request.mock.calls).toEqual([
        ['system.status'],
        ['system.requestUpdate', { targetVersion: '1.2.0' }],
        ['system.status'],
      ]);
      expect(mark).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, false, 'true', 1])(
    'never sends a mutation without boolean capability: %s',
    async (capability) => {
      const rpc = client();
      rpc.request.mockResolvedValue({
        version: '1.0.0',
        updateSupported: true,
        exactUpdateSupported: capability,
      });
      await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).resolves.toEqual({
        ok: false,
        reason: 'unsupported',
      });
      expect(rpc.request.mock.calls).toEqual([['system.status']]);
    },
  );

  it.each(['1.2.0', '1.3.0', 'unparseable'])(
    'never mutates a current/newer/unknown daemon: %s',
    async (version) => {
      const rpc = client();
      rpc.request.mockResolvedValue({ version, exactUpdateSupported: true });
      await updateDaemonToPin(rpc, '1.2.0', vi.fn());
      expect(rpc.request.mock.calls).toEqual([['system.status']]);
    },
  );

  it('does not connect a disconnected device or guess a missing bundle pin', async () => {
    const rpc = { ...client(), getStatus: () => 'disconnected' as const };
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).resolves.toEqual({
      ok: false,
      reason: 'not-connected',
    });
    expect(rpc.request).not.toHaveBeenCalled();
    const connected = client();
    await expect(updateDaemonToPin(connected, null, vi.fn())).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(connected.request).not.toHaveBeenCalled();
  });

  it('surfaces installation failure without a channel fallback', async () => {
    const rpc = client();
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
      .mockResolvedValueOnce({
        version: '1.0.0',
        targetUpdate: { targetVersion: '1.2.0', state: 'failed', message: 'checksum mismatch' },
      });
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'checksum mismatch',
    });
    expect(rpc.request.mock.calls.filter(([m]) => m === 'system.requestUpdate')).toEqual([
      ['system.requestUpdate', { targetVersion: '1.2.0' }],
    ]);
  });

  it('rejects an unacknowledged target and a reconnected version mismatch', async () => {
    for (const response of [
      { ok: true },
      { ok: true, targetVersion: '1.3.0' },
      { ok: true, targetVersion: 'v1.2.0' },
      { ok: true, targetVersion: '1.2.0+build.7' },
    ]) {
      const rpc = client();
      rpc.request
        .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
        .mockResolvedValueOnce(response);
      await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(/acknowledge/);
    }
    for (const version of ['1.3.0', 'v1.2.1+build.7', '1.2.0-rc.1', 'v1.2.0-rc.2+build.7']) {
      const rpc = client();
      rpc.request
        .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
        .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
        .mockResolvedValueOnce({ version });
      await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(
        /without the requested version/,
      );
    }
  });

  it('waits through install and reconnect, keeping update progress active', async () => {
    vi.useFakeTimers();
    let status: 'connected' | 'disconnected' = 'connected';
    const rpc = { ...client(), getStatus: () => status };
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
      .mockResolvedValueOnce({
        version: '1.0.0',
        targetUpdate: { targetVersion: '1.2.0', state: 'installing' },
      })
      .mockResolvedValueOnce({ version: '1.2.0' });
    const mark = vi.fn();
    const result = updateDaemonToPin(rpc, '1.2.0', mark);
    await vi.advanceTimersByTimeAsync(0);
    status = 'disconnected';
    await vi.advanceTimersByTimeAsync(1000);
    expect(rpc.request).toHaveBeenCalledTimes(3);
    status = 'connected';
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ ok: true });
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it('bounds a stuck installation and reports connection loss before acceptance', async () => {
    vi.useFakeTimers();
    const rpc = client();
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce({ version: '1.0.0' });
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow('connection closed');
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
      .mockResolvedValue({
        version: '1.0.0',
        targetUpdate: { targetVersion: '1.2.0', state: 'installing' },
      });
    const result = expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    await result;
  });
});

it('reconciles a lost acceptance without swallowing an explicit RPC rejection', async () => {
  const rpc = client();
  rpc.request
    .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
    .mockRejectedValueOnce(new Error('connection closed'))
    .mockResolvedValueOnce({ version: '1.2.0' });
  await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).resolves.toEqual({ ok: true });
  expect(
    rpc.request.mock.calls.filter(([method]) => method === 'system.requestUpdate'),
  ).toHaveLength(1);
  rpc.request
    .mockClear()
    .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
    .mockRejectedValueOnce(new JsonRpcError({ code: -32603, message: 'rejected' }));
  await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow('rejected');
  expect(rpc.request).toHaveBeenCalledTimes(2);
});

it('stops polling when the pooled connection is replaced', async () => {
  const rpc = client();
  rpc.request
    .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
    .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' });
  await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn(), () => false)).rejects.toThrow(
    /connection changed/,
  );
  expect(rpc.request).toHaveBeenCalledTimes(2);
});

describe('restarted daemon startup (intent-hq/intent#8104)', () => {
  it('waits through daemon-not-ready after restart and honours retryAfterMs', async () => {
    vi.useFakeTimers();
    const rpc = acceptedUpdate();
    rpc.request
      .mockRejectedValueOnce(startupError('daemon-not-ready', 3000))
      .mockRejectedValueOnce(startupError('daemon-not-ready', 3000))
      .mockResolvedValueOnce({ version: '1.2.0', exactUpdateSupported: true });
    const mark = vi.fn();
    const result = updateDaemonToPin(rpc, '1.2.0', mark);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2999);
    expect(rpc.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc.request).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toEqual({ ok: true });
    expect(rpc.request.mock.calls.filter(([m]) => m === 'system.requestUpdate')).toHaveLength(1);
    // Startup replies keep the update marked in progress, like `installing`.
    expect(mark).toHaveBeenCalledTimes(3);
  });

  it.each([
    { label: 'missing', retryAfterMs: undefined, expected: 1000 },
    { label: 'oversized', retryAfterMs: 60_000, expected: 5000 },
    { label: 'tiny', retryAfterMs: 1, expected: 250 },
  ])('bounds a $label retry delay to $expected ms', async ({ retryAfterMs, expected }) => {
    vi.useFakeTimers();
    const rpc = acceptedUpdate();
    rpc.request
      .mockRejectedValueOnce(startupError('daemon-not-ready', retryAfterMs))
      .mockResolvedValueOnce({ version: '1.2.0' });
    const result = updateDaemonToPin(rpc, '1.2.0', vi.fn());
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(rpc.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: true });
    expect(rpc.request).toHaveBeenCalledTimes(4);
  });

  it('reports a terminal startup failure of the new daemon as a failed update', async () => {
    const rpc = acceptedUpdate();
    rpc.request.mockRejectedValueOnce(startupError('daemon-startup-failed'));
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'Daemon startup failed',
    });
  });

  it('still times out when the new daemon never becomes ready', async () => {
    vi.useFakeTimers();
    const rpc = acceptedUpdate();
    rpc.request.mockRejectedValue(startupError('daemon-not-ready', 1000));
    const result = expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(12 * 60_000 + 5000);
    await result;
  });

  it('keeps throwing unrelated or malformed errors while connected', async () => {
    for (const error of [
      new JsonRpcError({ code: -32603, message: 'boom' }),
      new JsonRpcError({ code: -32012, message: 'Daemon not ready' }),
      new JsonRpcError({
        code: -32012,
        message: 'Daemon not ready',
        data: { code: 'daemon-not-ready', retryable: false },
      }),
    ]) {
      const rpc = acceptedUpdate();
      rpc.request.mockRejectedValueOnce(error);
      await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toBe(error);
    }
  });

  it('does not treat a not-ready reply to the update request itself as accepted', async () => {
    const rpc = client();
    const error = startupError('daemon-not-ready', 1000);
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockRejectedValueOnce(error);
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toBe(error);
    expect(rpc.request).toHaveBeenCalledTimes(2);
  });
});

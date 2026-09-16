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

describe('exact daemon updates', () => {
  it('sends the precise target and succeeds only after the daemon reports that version', async () => {
    const rpc = client();
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
      .mockResolvedValueOnce({ version: '1.2.0', exactUpdateSupported: true });
    const mark = vi.fn();
    await expect(updateDaemonToPin(rpc, '1.2.0', mark)).resolves.toEqual({ ok: true });
    expect(rpc.request.mock.calls).toEqual([
      ['system.status'],
      ['system.requestUpdate', { targetVersion: '1.2.0' }],
      ['system.status'],
    ]);
    expect(mark).toHaveBeenCalledOnce();
  });

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
    for (const response of [{ ok: true }, { ok: true, targetVersion: '1.3.0' }]) {
      const rpc = client();
      rpc.request
        .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
        .mockResolvedValueOnce(response);
      await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(/acknowledge/);
    }
    const rpc = client();
    rpc.request
      .mockResolvedValueOnce({ version: '1.0.0', exactUpdateSupported: true })
      .mockResolvedValueOnce({ ok: true, targetVersion: '1.2.0' })
      .mockResolvedValueOnce({ version: '1.3.0' });
    await expect(updateDaemonToPin(rpc, '1.2.0', vi.fn())).rejects.toThrow(
      /without the requested version/,
    );
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

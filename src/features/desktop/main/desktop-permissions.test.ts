import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { DesktopNativeAdapter } from './desktop-native';
import { desktopFailure } from './desktop-validation';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { requestDesktopPermissions, requestLocalDesktopPermissions } from './desktop-permissions';

const selection = { workspaceId: 'w', agentId: 'a', requestId: 'r', decision: 'allow_once' };
function setup() {
  const snapshot = {
    state: { status: 'pending_permission', requestId: 'r' },
    pending: {
      workspaceId: 'w',
      agentId: 'a',
      requestId: 'r',
      computerId: 'local',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  const client = Object.assign(new EventEmitter(), {
    getStatus: vi.fn(() => 'connected'),
    request: vi.fn(async () => snapshot),
  });
  const native = {
    identity: vi.fn(async () => ({ computerId: 'local', computerName: 'Mac', platform: 'macos' })),
    requestPermissions: vi.fn(async () => ({
      accessibility: false,
      screenRecording: false,
      screenCapture: 'ready',
    })),
  };
  return {
    client,
    native,
    snapshot,
    run: (p: unknown = selection) =>
      requestDesktopPermissions(
        client as unknown as JsonRpcClient,
        p,
        native as unknown as DesktopNativeAdapter,
      ),
  };
}
describe('local OS onboarding authorization', () => {
  it('preserves native refusal code/detail/execution through the existing IPC error serializer', async () => {
    const h = setup();
    h.native.requestPermissions.mockRejectedValueOnce(
      desktopFailure('desktop-unsupported-operation', 'The Mac session is locked', 'not_started'),
    );
    const error = await h.run().catch((error) => error);
    expect(error).toBeInstanceOf(JsonRpcError);
    expect(error.toErrorPayload()).toMatchObject({
      code: 'desktop-unsupported-operation',
      data: {
        code: 'desktop-unsupported-operation',
        detail: 'The Mac session is locked',
        execution: 'not_started',
      },
    });
  });

  it.each(['allow_once', 'allow_future'])(
    'requests only for the live %s candidate on this computer, without starting control',
    async (decision) => {
      const h = setup();
      expect(await h.run({ ...selection, decision })).toEqual({
        platform: 'macos',
        accessibility: false,
        screenRecording: false,
        screenCapture: 'ready',
      });
      expect(h.client.request).toHaveBeenCalledExactlyOnceWith('desktop.getState', {
        workspaceId: 'w',
        agentId: 'a',
      });
      expect(h.native.requestPermissions).toHaveBeenCalledExactlyOnceWith(
        'local',
        JSON.stringify(['w', 'a', 'r']),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(h.client.listenerCount('status')).toBe(0);
    },
  );
  it.each(['deny', 'allow', undefined])(
    'rejects non-Allow decision %s before any native operation',
    async (decision) => {
      const h = setup();
      await expect(h.run({ ...selection, decision })).rejects.toThrow();
      expect(h.native.identity).not.toHaveBeenCalled();
      expect(h.client.request).not.toHaveBeenCalled();
    },
  );
  it.each(['workspaceId', 'agentId', 'requestId', 'computerId', 'expiresAt'] as const)(
    'rejects stale/foreign %s',
    async (field) => {
      const h = setup();
      h.snapshot.pending[field] = field === 'expiresAt' ? new Date(0).toISOString() : 'foreign';
      await expect(h.run()).rejects.toThrow();
      expect(h.native.requestPermissions).not.toHaveBeenCalled();
    },
  );
  it('fails closed without a pending request and when the daemon denies access', async () => {
    const h = setup();
    h.client.request.mockResolvedValueOnce({ state: { status: 'inactive' } } as never);
    await expect(h.run()).rejects.toThrow();
    h.client.request.mockRejectedValueOnce(new Error('forbidden'));
    await expect(h.run()).rejects.toThrow('forbidden');
    expect(h.native.identity).not.toHaveBeenCalled();
  });
  it('rejects a disconnect/rehello during identity resolution', async () => {
    const h = setup();
    h.native.identity.mockImplementationOnce(async () => {
      h.client.emit('status', 'connecting');
      h.client.emit('status', 'connected');
      return { computerId: 'local', computerName: 'Mac', platform: 'macos' };
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.native.requestPermissions).not.toHaveBeenCalled();
  });
  it('revalidates overlapping setup requests independently instead of failing a second user gesture', async () => {
    const h = setup();
    let reject!: (e: Error) => void;
    h.client.request.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    h.client.request.mockResolvedValueOnce({
      state: { status: 'pending_permission', requestId: 'second' },
      pending: { ...h.snapshot.pending, agentId: 'other', requestId: 'second' },
    });
    const pending = h.run().catch((error: unknown) => error);
    const second = await h
      .run({ ...selection, agentId: 'other', requestId: 'second' })
      .catch((error: unknown) => error);
    reject(new Error('offline'));
    expect(await pending).toBeInstanceOf(Error);
    expect(second).toMatchObject({ platform: 'macos', accessibility: false });
    expect(h.client.request).toHaveBeenCalledTimes(2);
    expect(h.client.request).toHaveBeenLastCalledWith('desktop.getState', {
      workspaceId: 'w',
      agentId: 'other',
    });
    expect(h.native.requestPermissions).toHaveBeenCalledExactlyOnceWith(
      'local',
      JSON.stringify(['w', 'other', 'second']),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(h.client.listenerCount('status')).toBe(0);
  });
  it('returns the whole settled checklist from one readiness check per Allow gesture', async () => {
    const h = setup();
    h.native.requestPermissions.mockResolvedValueOnce({
      accessibility: true,
      screenRecording: false,
      screenCapture: 'blocked',
    });
    expect(await h.run()).toEqual({
      platform: 'macos',
      accessibility: true,
      screenRecording: false,
      screenCapture: 'blocked',
    });
    expect(h.native.requestPermissions).toHaveBeenCalledTimes(1);
  });
  it('does not request macOS permissions on Windows or claim Windows readiness', async () => {
    const h = setup();
    h.native.identity.mockResolvedValue({
      computerId: 'local',
      computerName: 'PC',
      platform: 'windows',
    });
    expect(await h.run()).toEqual({ platform: 'windows' });
    expect(h.native.requestPermissions).not.toHaveBeenCalled();
  });
});

const pending = { accessibility: true, screenRecording: true, screenCapture: 'pending' };
const ready = { accessibility: true, screenRecording: true, screenCapture: 'ready' };
/** A helper whose capture check settles only when the same id asks again. */
function helper(...answers: unknown[]) {
  const request = vi.fn(async (operation: string) => {
    if (operation === 'identity')
      return { computerId: 'local', computerName: 'Mac', platform: 'macos' };
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const asks = () => request.mock.calls.filter(([operation]) => operation === 'requestPermissions');
  return { request, asks, adapter: new DesktopNativeAdapter(request) };
}
async function settled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  await vi.runAllTimersAsync();
  return promise;
}

describe('shared OS permission readiness', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('accepts only observed permission booleans, not a generic success acknowledgement', async () => {
    const h = helper({ ok: true });
    await expect(h.adapter.requestPermissions('local', 'request')).rejects.toThrow();
  });

  it('re-asks with the same request id until a granted capture check settles', async () => {
    const h = helper(pending, pending, ready);
    await expect(settled(h.adapter.requestPermissions('local', 'request'))).resolves.toEqual(ready);
    expect(h.asks()).toEqual(
      Array(3).fill(['requestPermissions', { computerId: 'local', requestId: 'request' }]),
    );
  });

  it('re-asks well inside the helper three-second abandon window', async () => {
    const h = helper(pending, ready);
    const result = h.adapter.requestPermissions('local', 'request');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual(ready);
    expect(h.asks()).toHaveLength(2);
  });

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    'reports a blocked check without re-asking while a grant is missing (%s, %s)',
    async (accessibility, screenRecording) => {
      const h = helper({ accessibility, screenRecording, screenCapture: 'pending' });
      await expect(settled(h.adapter.requestPermissions('local', 'request'))).resolves.toEqual({
        accessibility,
        screenRecording,
        screenCapture: 'blocked',
      });
      expect(h.asks()).toHaveLength(1);
    },
  );

  it('reports checking after the hold while main keeps settling one shared check', async () => {
    const h = helper(pending, pending, pending, pending, pending, ready);
    const first = h.adapter.requestPermissions('local', 'request');
    await vi.advanceTimersByTimeAsync(1500);
    await expect(first).resolves.toEqual({ ...ready, screenCapture: 'checking' });
    await vi.advanceTimersByTimeAsync(100);
    const second = h.adapter.requestPermissions('local', 'request');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toEqual(ready);
    expect(h.asks()).toHaveLength(6);
  });

  it('ends a check that outlasts its deadline as not confirmed', async () => {
    const h = helper(pending);
    const result = settled(
      h.adapter.requestPermissions('local', 'request', {
        deadline: Date.now() + 2000,
        holdMs: 5000,
      }),
    );
    await expect(result).resolves.toEqual({ ...ready, screenCapture: 'unavailable' });
    const asked = h.asks().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.asks()).toHaveLength(asked);
  });

  it('gives up after two minutes without a deadline', async () => {
    const h = helper(pending);
    const result = h.adapter.requestPermissions('local', 'request', { holdMs: Infinity });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(h.asks().length).toBeGreaterThan(200);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ ...ready, screenCapture: 'unavailable' });
  });

  it('follows a deadline later than two minutes', async () => {
    const h = helper(pending);
    let outcome: unknown;
    void h.adapter
      .requestPermissions('local', 'request', {
        deadline: Date.now() + 300_000,
        holdMs: Infinity,
      })
      .then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(outcome).toEqual({ ...ready, screenCapture: 'unavailable' });
  });

  it('rejects the waiting call with the caller reason when cancelled', async () => {
    const h = helper(pending);
    const controller = new AbortController();
    const result = h.adapter.requestPermissions('local', 'request', { signal: controller.signal });
    result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(600);
    const reason = new Error('stale');
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
  });

  it('propagates a refusal of the first ask', async () => {
    const refusal = desktopFailure('desktop-busy', 'Desktop control is already active');
    const h = helper(refusal);
    await expect(settled(h.adapter.requestPermissions('local', 'request'))).rejects.toBe(refusal);
  });

  it('ends the check as not confirmed when a later re-ask is refused', async () => {
    const h = helper(
      pending,
      desktopFailure('desktop-unsupported-operation', 'The Mac session is locked'),
      ready,
    );
    await expect(settled(h.adapter.requestPermissions('local', 'request'))).resolves.toEqual({
      ...ready,
      screenCapture: 'unavailable',
    });
    expect(h.asks()).toHaveLength(2);
  });

  it('settles a pending check for both the agent Allow flow and the Settings flow', async () => {
    const agent = helper(pending, pending, ready);
    const h = setup();
    await expect(
      settled(
        requestDesktopPermissions(h.client as unknown as JsonRpcClient, selection, agent.adapter),
      ),
    ).resolves.toEqual({ platform: 'macos', ...ready });
    expect(new Set(agent.asks().map(([, params]) => JSON.stringify(params))).size).toBe(1);
    expect(agent.asks()).toHaveLength(3);

    const settings = helper(pending, pending, ready);
    await expect(
      settled(
        requestLocalDesktopPermissions(
          { requestId: '0b9f6a52-3c1e-4b8a-9d2f-6e5a4c3b2a10' },
          settings.adapter,
          () => true,
        ),
      ),
    ).resolves.toEqual({ platform: 'macos', ...ready });
    expect(new Set(settings.asks().map(([, params]) => JSON.stringify(params))).size).toBe(1);
    expect(settings.asks()).toHaveLength(3);
  });

  it('stops the agent check as stale when the daemon connection changes', async () => {
    const agent = helper(pending);
    const h = setup();
    const result = requestDesktopPermissions(
      h.client as unknown as JsonRpcClient,
      selection,
      agent.adapter,
    );
    result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(600);
    h.client.emit('status', 'connecting');
    const error = await result.catch((e) => e);
    expect(error.toErrorPayload()).toMatchObject({ code: 'desktop-stale-request' });
    expect(h.client.listenerCount('status')).toBe(0);
  });

  it('never keeps checking past the agent request expiry', async () => {
    const agent = helper(pending);
    const h = setup();
    h.snapshot.pending.expiresAt = new Date(Date.now() + 5000).toISOString();
    const run = () =>
      requestDesktopPermissions(h.client as unknown as JsonRpcClient, selection, agent.adapter);
    const first = run();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(first).resolves.toEqual({
      platform: 'macos',
      ...ready,
      screenCapture: 'checking',
    });
    await vi.advanceTimersByTimeAsync(4000);
    const asked = agent.asks().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agent.asks()).toHaveLength(asked);
    const error = await run().catch((e) => e);
    expect(error.toErrorPayload()).toMatchObject({ code: 'desktop-stale-request' });
  });
});

describe('settings-initiated OS permission request', () => {
  function native(platform: 'macos' | 'windows' = 'macos') {
    return {
      identity: vi.fn(async () => ({ computerId: 'local', computerName: 'Mac', platform })),
      requestPermissions: vi.fn(async () => ({
        accessibility: true,
        screenRecording: false,
        screenCapture: 'blocked' as const,
      })),
    };
  }
  const id = '0b9f6a52-3c1e-4b8a-9d2f-6e5a4c3b2a10';
  const run = (
    n: ReturnType<typeof native>,
    available = true,
    value: unknown = { requestId: id },
  ) => requestLocalDesktopPermissions(value, n as unknown as DesktopNativeAdapter, () => available);

  it('reports unsupported without launching the helper when it is unavailable', async () => {
    const n = native();
    expect(await run(n, false)).toEqual({ platform: 'unsupported' });
    expect(n.identity).not.toHaveBeenCalled();
    expect(n.requestPermissions).not.toHaveBeenCalled();
  });

  it('needs no OS prompt on Windows', async () => {
    const n = native('windows');
    expect(await run(n)).toEqual({ platform: 'windows' });
    expect(n.requestPermissions).not.toHaveBeenCalled();
  });

  it('reuses the caller request identity so a pending capture check can settle', async () => {
    const n = native();
    expect(await run(n)).toEqual({
      platform: 'macos',
      accessibility: true,
      screenRecording: false,
      screenCapture: 'blocked',
    });
    await run(n);
    const [first, second] = n.requestPermissions.mock.calls as unknown as [string, string][];
    expect(first).toEqual(['local', `settings:${id}`]);
    expect(second).toEqual(first);
  });

  it.each([null, {}, { requestId: 'x' }, { requestId: id, extra: 1 }])(
    'rejects a malformed request %j before touching the helper',
    async (value) => {
      const n = native();
      await expect(run(n, true, value)).rejects.toThrow();
      expect(n.identity).not.toHaveBeenCalled();
    },
  );

  it('serializes a native refusal as a JSON-RPC error', async () => {
    const n = native();
    n.requestPermissions.mockRejectedValueOnce(
      desktopFailure('desktop-busy', 'Desktop control is already active', 'not_started'),
    );
    const error = await run(n).catch((e) => e);
    expect(error).toBeInstanceOf(JsonRpcError);
    expect(error.toErrorPayload()).toMatchObject({ code: 'desktop-busy' });
  });
});

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { DesktopNativeAdapter } from './desktop-native';
import { desktopFailure } from './desktop-validation';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { requestDesktopPermissions } from './desktop-permissions';

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
    );
    expect(h.client.listenerCount('status')).toBe(0);
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

describe('helper permission response boundary', () => {
  it('accepts only observed permission booleans, not a generic success acknowledgement', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      accessibility: false,
      screenRecording: true,
      screenCapture: 'ready',
    });
    const adapter = new DesktopNativeAdapter(request);
    await expect(adapter.requestPermissions('local', 'request')).rejects.toThrow();
    await expect(adapter.requestPermissions('local', 'request')).resolves.toEqual({
      accessibility: false,
      screenRecording: true,
      screenCapture: 'ready',
    });
    expect(request).toHaveBeenLastCalledWith('requestPermissions', {
      computerId: 'local',
      requestId: 'request',
    });
  });
});

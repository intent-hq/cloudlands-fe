import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc-registry';

const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, any>,
  invoke: vi.fn(),
  listeners: new Map<string, (event: unknown, message: unknown) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      electron.exposed[key] = value;
    },
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: (channel: string, listener: (event: unknown, message: unknown) => void) => {
      electron.listeners.set(channel, listener);
    },
  },
}));

describe('Intent app window preload (window.intent)', () => {
  let intent: any;
  beforeAll(async () => {
    await import('./intent-app');
    intent = electron.exposed.intent;
  });

  it('exposes only window.intent, with bridgeVersion 1', () => {
    expect(Object.keys(electron.exposed)).toEqual(['intent']);
    expect(intent.bridgeVersion).toBe(1);
  });

  it('invokes the registry channel with { call, args } and resolves the result', async () => {
    electron.invoke.mockResolvedValueOnce({ ok: true, result: 7 });
    await expect(intent.storage.get('count')).resolves.toBe(7);
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.INTENT_APP.INVOKE, {
      call: 'storage.get',
      args: ['count'],
    });
  });

  it('rejects with a plain { code, message, data } object (survives contextBridge)', async () => {
    electron.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'rate-limited', message: 'slow down', data: { retryAfterMs: 1000 } },
    });
    await expect(intent.notifications.show({ title: 'x' })).rejects.toEqual({
      name: 'IntentError',
      code: 'rate-limited',
      message: 'slow down',
      data: { retryAfterMs: 1000 },
    });
    electron.invoke.mockRejectedValueOnce(new Error('gone'));
    await expect(intent.models.list()).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('delivers host events on the registry channel to intent.on listeners', () => {
    const listener = vi.fn();
    const off = intent.on('session-ended', listener);
    const deliver = electron.listeners.get(IPC_CHANNELS.INTENT_APP.EVENT)!;
    deliver({}, { type: 'session-ended', data: { reason: 'revoked' } });
    expect(listener).toHaveBeenCalledWith({ reason: 'revoked' });
    off();
    deliver({}, { type: 'session-ended', data: { reason: 'closed' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => intent.on('message', () => {})).toThrow(TypeError);
  });
});

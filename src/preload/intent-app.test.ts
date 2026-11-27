import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc-registry';

const electron = vi.hoisted(() => ({
  exposed: [] as string[],
  invoke: vi.fn(),
  listeners: new Map<string, (event: unknown, message: unknown) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string) => electron.exposed.push(key),
    // The page's main world: run the installer as Electron would.
    executeInMainWorld: ({ func, args }: { func: (...a: unknown[]) => void; args: unknown[] }) =>
      func(...args),
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
    // The grant main passes in additionalArguments: level 2 without globalShortcuts.
    process.argv.push('--intent-app-level=2', '--intent-app-features=models,notifications');
    await import('./intent-app');
    intent = (globalThis as any).intent;
  });

  it('defines only window.intent, frozen, with bridgeVersion 1', () => {
    expect(electron.exposed).toEqual([]);
    expect(intent.bridgeVersion).toBe(1);
    expect(Object.isFrozen(intent)).toBe(true);
  });

  it('invokes the registry channel with { call, args } and resolves the result', async () => {
    electron.invoke.mockResolvedValueOnce({ ok: true, result: 7 });
    await expect(intent.storage.get('count')).resolves.toBe(7);
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.INTENT_APP.INVOKE, {
      call: 'storage.get',
      args: ['count'],
    });
  });

  it('rejects with an IntentError that keeps code and data', async () => {
    electron.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'rate-limited', message: 'slow down', data: { retryAfterMs: 1000 } },
    });
    const error = await intent.notifications.show({ title: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
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
  });

  it('refuses synchronously: unknown types not-supported, shortcut without the grant forbidden', () => {
    const thrown = (type: string) => {
      try {
        intent.on(type, () => {});
        return null;
      } catch (error) {
        return error as { code?: string };
      }
    };
    expect(thrown('message')).toMatchObject({ name: 'IntentError', code: 'not-supported' });
    expect(thrown('shortcut')).toMatchObject({ name: 'IntentError', code: 'forbidden' });
    expect(thrown('session-ended')).toBeNull();
  });
});

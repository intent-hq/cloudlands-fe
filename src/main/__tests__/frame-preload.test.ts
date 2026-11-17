import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(async () => null as unknown),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => electron.exposed.set(key, api),
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { FrameBridge } from '../../shared/frame-route';

describe('frame page preload', () => {
  beforeEach(async () => {
    vi.resetModules();
    electron.exposed.clear();
    await import('../../preload/frame');
  });

  const bridge = () => electron.exposed.get('frameBridge') as FrameBridge;

  it('exposes only the backdrop bridge, no general app IPC', () => {
    expect([...electron.exposed.keys()]).toEqual(['frameBridge']);
    expect(Object.keys(bridge()).sort()).toEqual(['getBackdrop', 'onBackdrop']);
  });

  it('reads and follows the backdrop on the machine rail channels', async () => {
    const backdrop = { background: 'black', tint: 'teal', reducedMotion: false };
    electron.invoke.mockResolvedValueOnce(backdrop);
    await expect(bridge().getBackdrop()).resolves.toEqual(backdrop);
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.MACHINE_RAIL.GET_BACKDROP, {});

    const seen: unknown[] = [];
    const off = bridge().onBackdrop((next) => seen.push(next));
    const [channel, listener] = electron.on.mock.calls.at(-1) as [
      string,
      (event: unknown, next: unknown) => void,
    ];
    expect(channel).toBe(IPC_CHANNELS.MACHINE_RAIL.BACKDROP_CHANGED);
    listener({}, backdrop);
    expect(seen).toEqual([backdrop]);
    off();
    expect(electron.removeListener).toHaveBeenCalledWith(channel, listener);
  });
});

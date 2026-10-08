import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '$shared/generated/ipc-client';
import { resetMockIpcRouter } from '$shared/ipc-mock-router';
import type { CustomViewInput, CustomViewsResponse } from '$shared/types/custom-views';
import { registerCustomViewsBridge } from './custom-views-bridge-seeder';

const originalBridge = window.electronAPI;
const id = 'efcc1165-5813-4404-b774-2a89c6ee3a98';
const input: CustomViewInput = {
  name: 'Dashboard',
  directory: '/tmp/app',
  command: 'npm start',
  port: 3000,
  icon: 'chart',
};
const requests: Array<[string, object?]> = [
  ['custom-views:list'],
  ['custom-views:save', input],
  ['custom-views:remove', { id }],
  ['custom-views:start', { id }],
  ['custom-views:stop', { id }],
];
const response: CustomViewsResponse = {
  success: true,
  data: { views: [{ ...input, id }], runtimes: [{ id, status: 'starting', logs: '' }] },
};

function setBridge(bridge: unknown) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: bridge,
  });
}

beforeEach(() => {
  resetMockIpcRouter();
});
afterEach(() => {
  setBridge(originalBridge);
  resetMockIpcRouter();
});

describe('custom view renderer bridge', () => {
  it.each(requests)(
    'forwards %s from generated invoke to real preload with the exact payload',
    async (channel, payload) => {
      const nativeInvoke = vi.fn().mockResolvedValue(response);
      setBridge({ invoke: nativeInvoke, versions: { electron: '41.0.3' } });
      registerCustomViewsBridge();
      const result = payload === undefined ? await invoke(channel) : await invoke(channel, payload);
      expect(nativeInvoke.mock.calls).toEqual([
        payload === undefined ? [channel] : [channel, payload],
      ]);
      expect(result).toEqual(response);
    },
  );

  it.each(['absent', 'browser-mock', 'missing-invoke'])(
    'returns desktop-only on %s without reaching a native command',
    async (mode) => {
      const nativeInvoke = vi.fn();
      setBridge(
        mode === 'absent'
          ? undefined
          : mode === 'browser-mock'
            ? { invoke: nativeInvoke, versions: { electron: '0.0.0-browser' } }
            : { versions: { electron: '41.0.3' } },
      );
      registerCustomViewsBridge();
      for (const [channel, payload] of requests) {
        const result =
          payload === undefined ? await invoke(channel) : await invoke(channel, payload);
        expect(result).toMatchObject({ success: false, error: { code: 'desktop-only' } });
      }
      expect(nativeInvoke).not.toHaveBeenCalled();
    },
  );

  it('passes main-process failure responses through and preserves transport rejections', async () => {
    const failure: CustomViewsResponse = {
      success: false,
      error: { code: 'port-in-use', message: 'Port occupied' },
    };
    const nativeInvoke = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error('Preload unavailable'));
    setBridge({ invoke: nativeInvoke, versions: { electron: '41.0.3' } });
    registerCustomViewsBridge();
    expect(await invoke('custom-views:start', { id })).toEqual(failure);
    await expect(invoke('custom-views:start', { id })).rejects.toThrow('Preload unavailable');
  });

  it('registers idempotently without duplicating native calls', async () => {
    const nativeInvoke = vi.fn().mockResolvedValue(response);
    setBridge({ invoke: nativeInvoke, versions: { electron: '41.0.3' } });
    registerCustomViewsBridge();
    registerCustomViewsBridge();
    await invoke('custom-views:list');
    expect(nativeInvoke).toHaveBeenCalledExactlyOnceWith('custom-views:list');
  });
});

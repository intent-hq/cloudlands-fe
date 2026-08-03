import { describe, expect, it, vi } from 'vitest';

import {
  CLEAR_LIGHTING_CHANNEL,
  CLEAR_LIGHTING_DONE_CHANNEL,
  requestHardwareConsoleLightingClear,
  type ClearLightingIpc,
  type ClearLightingWindow,
} from '../clear-lighting-shutdown';

function makeWindow(id: number, opts: { destroyed?: boolean; sendThrows?: boolean } = {}) {
  const send = vi.fn((_channel: string) => {
    if (opts.sendThrows) throw new Error('webContents gone');
  });
  const win: ClearLightingWindow = {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      id,
      isDestroyed: () => false,
      send,
    },
  };
  return { win, send };
}

function makeIpc() {
  const listeners = new Map<string, Set<(event: { sender: { id: number } }) => void>>();
  const ipc: ClearLightingIpc = {
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
  };
  const ack = (senderId: number) => {
    for (const listener of listeners.get(CLEAR_LIGHTING_DONE_CHANNEL) ?? []) {
      listener({ sender: { id: senderId } });
    }
  };
  const listenerCount = (channel: string) => listeners.get(channel)?.size ?? 0;
  return { ipc, ack, listenerCount };
}

describe('requestHardwareConsoleLightingClear', () => {
  it('broadcasts to every live window and resolves promptly once all windows ack', async () => {
    const { win: w1, send: send1 } = makeWindow(1);
    const { win: w2, send: send2 } = makeWindow(2);
    const { ipc, ack, listenerCount } = makeIpc();

    const promise = requestHardwareConsoleLightingClear([w1, w2], ipc, 5_000);
    expect(send1).toHaveBeenCalledWith(CLEAR_LIGHTING_CHANNEL);
    expect(send2).toHaveBeenCalledWith(CLEAR_LIGHTING_CHANNEL);

    ack(1);
    ack(2);
    await promise;
    expect(listenerCount(CLEAR_LIGHTING_DONE_CHANNEL)).toBe(0);
  });

  it('resolves at the overall timeout when an ack never arrives', async () => {
    const { win } = makeWindow(1);
    const { ipc, listenerCount } = makeIpc();

    const start = Date.now();
    await requestHardwareConsoleLightingClear([win], ipc, 25);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    expect(listenerCount(CLEAR_LIGHTING_DONE_CHANNEL)).toBe(0);
  });

  it('resolves immediately with zero windows without registering a listener', async () => {
    const { ipc, listenerCount } = makeIpc();
    await requestHardwareConsoleLightingClear([], ipc, 5_000);
    expect(listenerCount(CLEAR_LIGHTING_DONE_CHANNEL)).toBe(0);
  });

  it('skips destroyed windows and only waits on live ones', async () => {
    const { win: dead, send: deadSend } = makeWindow(1, { destroyed: true });
    const { win: live, send: liveSend } = makeWindow(2);
    const { ipc, ack } = makeIpc();

    const promise = requestHardwareConsoleLightingClear([dead, live], ipc, 5_000);
    expect(deadSend).not.toHaveBeenCalled();
    expect(liveSend).toHaveBeenCalledWith(CLEAR_LIGHTING_CHANNEL);

    ack(2);
    await promise;
  });

  it('does not wait for a window whose send() throws', async () => {
    const { win } = makeWindow(1, { sendThrows: true });
    const { ipc } = makeIpc();

    const start = Date.now();
    await requestHardwareConsoleLightingClear([win], ipc, 5_000);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it('a duplicate ack from one window does not complete the wait while another is pending', async () => {
    const { win: w1 } = makeWindow(1);
    const { win: w2 } = makeWindow(2);
    const { ipc, ack } = makeIpc();

    let resolved = false;
    const promise = requestHardwareConsoleLightingClear([w1, w2], ipc, 5_000).then(() => {
      resolved = true;
    });

    ack(1);
    ack(1);
    await Promise.resolve();
    expect(resolved).toBe(false);

    ack(2);
    await promise;
    expect(resolved).toBe(true);
  });
});

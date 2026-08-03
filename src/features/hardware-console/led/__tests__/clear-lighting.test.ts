import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';
import {
  clearHardwareConsoleLighting,
  installHardwareConsoleClearLightingListener,
  type ClearLightingIpcLike,
} from '../clear-lighting';
import { AGENT_KEY_LED_COUNT, LED_EFFECT_OFF, type ThStatusEntry } from '../frames';

function makeFakeManager(
  status: HardwareConsoleStatus = 'connected',
  call?: (method: string, params: unknown) => Promise<unknown>,
) {
  const calls: { method: string; params: unknown }[] = [];
  const client = {
    call: vi.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      return call ? call(method, params) : Promise.resolve({ ok: 1 });
    }),
  };
  return {
    fake: {
      status,
      client: status === 'connected' ? client : null,
    } as unknown as HardwareConsoleManager,
    calls,
  };
}

function makeFakeIpc() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const sent: string[] = [];
  const ipc: ClearLightingIpcLike = {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      handlers.set(channel, handler);
      return 'listener-id';
    }),
    send: vi.fn((channel: string) => {
      sent.push(channel);
    }),
  };
  return { ipc, handlers, sent };
}

async function emitClearLighting(handlers: Map<string, (...args: unknown[]) => void>) {
  handlers.get('hardware-console:clear-lighting')!();
  // The handler acks in an async finally; let the microtask queue drain.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('clearHardwareConsoleLighting', () => {
  it('sends exactly the two off-frame RPCs when connected', async () => {
    const { fake, calls } = makeFakeManager('connected');
    await clearHardwareConsoleLighting(fake);
    expect(calls.map((entry) => entry.method)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    const frame = calls[0].params as ThStatusEntry[];
    expect(frame).toHaveLength(AGENT_KEY_LED_COUNT);
    for (const entry of frame) {
      expect(entry).toMatchObject({ e: LED_EFFECT_OFF, b: 0 });
    }
    expect(calls[1].params).toMatchObject({
      keys: { e: LED_EFFECT_OFF, b: 0 },
      ambient: { e: LED_EFFECT_OFF, b: 0 },
    });
  });

  it('resolves immediately without RPCs when disconnected', async () => {
    const { fake, calls } = makeFakeManager('disconnected');
    await clearHardwareConsoleLighting(fake);
    expect(calls).toHaveLength(0);
  });

  it('swallows RPC errors', async () => {
    const { fake, calls } = makeFakeManager('connected', () => Promise.reject(new Error('nope')));
    await expect(clearHardwareConsoleLighting(fake)).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('resolves at the timeout when the device never answers', async () => {
    vi.useFakeTimers();
    const { fake } = makeFakeManager('connected', () => new Promise(() => {}));
    let resolved = false;
    const pending = clearHardwareConsoleLighting(fake, { timeoutMs: 200 }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });
});

describe('installHardwareConsoleClearLightingListener', () => {
  it('disposes the LED wiring, clears, then acks', async () => {
    const { fake, calls } = makeFakeManager('connected');
    const { ipc, handlers, sent } = makeFakeIpc();
    const order: string[] = [];
    const disposeLedWiring = vi.fn(() => order.push('dispose'));
    installHardwareConsoleClearLightingListener(fake, { ipc, disposeLedWiring });
    expect(ipc.on).toHaveBeenCalledWith('hardware-console:clear-lighting', expect.any(Function));

    await emitClearLighting(handlers);
    expect(disposeLedWiring).toHaveBeenCalledOnce();
    expect(calls.map((entry) => entry.method)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    expect(sent).toEqual(['hardware-console:clear-lighting-done']);
  });

  it('acks even when no device is connected', async () => {
    const { fake, calls } = makeFakeManager('disconnected');
    const { ipc, handlers, sent } = makeFakeIpc();
    installHardwareConsoleClearLightingListener(fake, { ipc });

    await emitClearLighting(handlers);
    expect(calls).toHaveLength(0);
    expect(sent).toEqual(['hardware-console:clear-lighting-done']);
  });

  it('acks even when the clear helper throws', async () => {
    const { fake } = makeFakeManager('connected');
    const { ipc, handlers, sent } = makeFakeIpc();
    installHardwareConsoleClearLightingListener(fake, {
      ipc,
      clear: () => Promise.reject(new Error('boom')),
    });

    await emitClearLighting(handlers);
    expect(sent).toEqual(['hardware-console:clear-lighting-done']);
  });

  it('no-ops without a preload bridge', () => {
    const { fake } = makeFakeManager('connected');
    expect(() => installHardwareConsoleClearLightingListener(fake, { ipc: null })).not.toThrow();
  });
});

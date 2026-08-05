import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, HardwareLedEngine } from '../engine';
import type { HardwareLedSnapshot } from '../frames';

const IDLE_SNAPSHOT: HardwareLedSnapshot = {
  keys: ['idle', 'idle', 'unassigned', 'unassigned', 'unassigned', 'unassigned'],
  ambient: { kind: 'dark' },
};

const RUNNING_SNAPSHOT: HardwareLedSnapshot = {
  keys: ['running', 'idle', 'unassigned', 'unassigned', 'unassigned', 'unassigned'],
  ambient: { kind: 'running', runningCount: 1 },
};

function makeCaller(behavior: (method: string) => Promise<unknown> = () => Promise.resolve({ ok: 1 })) {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    call: vi.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      return behavior(method);
    }),
  };
}

function methods(calls: { method: string }[]): string[] {
  return calls.map((entry) => entry.method);
}

/** Flush pending microtasks so send promise settlements run under fake timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('HardwareLedEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends nothing before a caller is attached', () => {
    const engine = new HardwareLedEngine();
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    // No caller — nothing to assert beyond not throwing.
  });

  it('attach + update sends one full thstatus frame and rgbcfg', async () => {
    const caller = makeCaller();
    const engine = new HardwareLedEngine();
    engine.update(IDLE_SNAPSHOT);
    engine.attach(caller);
    vi.runAllTimers();
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    const frame = caller.calls[0].params as { id: number }[];
    expect(frame.map((entry) => entry.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('does not resend identical snapshots', () => {
    const caller = makeCaller();
    const engine = new HardwareLedEngine();
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    engine.update({ ...IDLE_SNAPSHOT });
    vi.runAllTimers();
    expect(caller.calls).toHaveLength(2);
  });

  it('coalesces rapid updates to <= ~10fps sending only the latest', () => {
    const caller = makeCaller();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 100 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    caller.calls.length = 0;
    // Burst of changes inside the throttle window.
    engine.update(RUNNING_SNAPSHOT);
    engine.update(IDLE_SNAPSHOT);
    engine.update(RUNNING_SNAPSHOT);
    expect(caller.calls).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    const frame = caller.calls[0].params as { id: number; e: number }[];
    // Slot 0 drives LED id 2 (SLOT_TO_LED_ID).
    expect(frame.find((entry) => entry.id === 2)?.e).toBe(4); // breath — the LATEST (running) state won
  });

  it('resends only the method whose params changed', () => {
    const caller = makeCaller();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    caller.calls.length = 0;
    engine.update({ ...IDLE_SNAPSHOT, keys: ['complete', ...IDLE_SNAPSHOT.keys.slice(1)] });
    vi.runAllTimers();
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus']);
  });

  it('replays BOTH frames after detach/attach (reconnect)', () => {
    const caller1 = makeCaller();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    engine.attach(caller1);
    engine.update(RUNNING_SNAPSHOT);
    vi.runAllTimers();
    engine.detach();
    const caller2 = makeCaller();
    engine.attach(caller2);
    vi.runAllTimers();
    expect(methods(caller2.calls)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    expect(caller2.calls[0].params).toEqual(caller1.calls[0].params);
    expect(caller2.calls[1].params).toEqual(caller1.calls[1].params);
  });

  it('a failed send is retried after the backoff window, not on the next update', async () => {
    let fail = true;
    const caller = makeCaller(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve({ ok: 1 }),
    );
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle();
    expect(caller.calls).toHaveLength(2);
    fail = false;
    caller.calls.length = 0;
    engine.update({ ...IDLE_SNAPSHOT }); // identical content — gated by backoff
    await settle();
    expect(caller.calls).toHaveLength(0);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    await settle();
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
  });

  it('failed sends back off exponentially (~2x gaps) up to the cap', async () => {
    const caller = makeCaller(() => Promise.reject(new Error('boom')));
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle();
    expect(caller.calls).toHaveLength(2);
    const gaps = [1000, 2000, 4000, 8000, 16000, 32000, BACKOFF_CAP_MS, BACKOFF_CAP_MS];
    for (const gap of gaps) {
      caller.calls.length = 0;
      vi.advanceTimersByTime(gap - 1);
      await settle();
      expect(caller.calls).toHaveLength(0);
      vi.advanceTimersByTime(1);
      await settle();
      expect(caller.calls).toHaveLength(2);
    }
  });

  it('applies full jitter: random()=0 halves the delay', async () => {
    const caller = makeCaller(() => Promise.reject(new Error('boom')));
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 0 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle();
    caller.calls.length = 0;
    vi.advanceTimersByTime(BACKOFF_BASE_MS / 2 - 1);
    await settle();
    expect(caller.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(caller.calls).toHaveLength(2);
  });

  it('a successful send resets the backoff streak', async () => {
    let fail = true;
    const caller = makeCaller(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve({ ok: 1 }),
    );
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle(); // failure #1 → next retry in 1000
    vi.advanceTimersByTime(1000);
    await settle(); // failure #2 → next retry in 2000
    fail = false;
    vi.advanceTimersByTime(2000);
    await settle(); // success → streak reset
    fail = true;
    caller.calls.length = 0;
    engine.update(RUNNING_SNAPSHOT);
    await settle(); // fresh failure → retry in 1000, not 4000
    caller.calls.length = 0;
    vi.advanceTimersByTime(999);
    await settle();
    expect(caller.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(caller.calls).toHaveLength(2);
  });

  it('attach() resets backoff state for the fresh transport', async () => {
    const caller1 = makeCaller(() => Promise.reject(new Error('boom')));
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller1);
    engine.update(IDLE_SNAPSHOT);
    await settle(); // failure #1
    vi.advanceTimersByTime(1000);
    await settle(); // failure #2
    vi.advanceTimersByTime(2000);
    await settle(); // failure #3 → next gap would be 8000
    engine.detach();
    const caller2 = makeCaller(() => Promise.reject(new Error('boom')));
    engine.attach(caller2); // replays immediately, streak reset first
    await settle();
    expect(caller2.calls).toHaveLength(2); // fresh failure → retry in 1000
    caller2.calls.length = 0;
    vi.advanceTimersByTime(999);
    await settle();
    expect(caller2.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(caller2.calls).toHaveLength(2);
  });

  it('updates during backoff coalesce and the latest snapshot wins at expiry', async () => {
    const caller = makeCaller(() => Promise.reject(new Error('boom')));
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle(); // failure → backing off
    caller.calls.length = 0;
    engine.update(RUNNING_SNAPSHOT);
    engine.update(IDLE_SNAPSHOT);
    engine.update(RUNNING_SNAPSHOT);
    await settle();
    expect(caller.calls).toHaveLength(0); // gated by backoff
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    await settle();
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    const frame = caller.calls[0].params as { id: number; e: number }[];
    expect(frame.find((entry) => entry.id === 2)?.e).toBe(4); // breath — the LATEST (running) state won
  });

  it('detach/dispose cancels a pending backoff retry', async () => {
    const caller = makeCaller(() => Promise.reject(new Error('boom')));
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    await settle(); // failure → retry armed
    caller.calls.length = 0;
    engine.detach();
    vi.advanceTimersByTime(BACKOFF_CAP_MS * 2);
    await settle();
    expect(caller.calls).toHaveLength(0);
    engine.attach(caller);
    await settle();
    caller.calls.length = 0;
    engine.dispose();
    vi.advanceTimersByTime(BACKOFF_CAP_MS * 2);
    await settle();
    expect(caller.calls).toHaveLength(0);
  });

  it('warns only on the first failure of a streak', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let fail = true;
      const caller = makeCaller(() =>
        fail ? Promise.reject(new Error('boom')) : Promise.resolve({ ok: 1 }),
      );
      const engine = new HardwareLedEngine({ minSendIntervalMs: 0, random: () => 1 });
      engine.attach(caller);
      engine.update(IDLE_SNAPSHOT);
      await settle(); // streak starts → one warn (second RPC failure is debug)
      expect(warnSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      await settle();
      vi.advanceTimersByTime(2000);
      await settle();
      expect(warnSpy).toHaveBeenCalledTimes(1); // retries stay quiet
      fail = false;
      vi.advanceTimersByTime(4000);
      await settle(); // recovery
      fail = true;
      engine.update(RUNNING_SNAPSHOT);
      await settle(); // new streak → one more warn
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('detach cancels a pending coalesced flush', () => {
    const caller = makeCaller();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 100 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    caller.calls.length = 0;
    engine.update(RUNNING_SNAPSHOT);
    engine.detach();
    vi.advanceTimersByTime(1000);
    expect(caller.calls).toHaveLength(0);
  });
});

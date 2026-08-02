import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HardwareLedEngine } from '../engine';
import type { HardwareLedSnapshot } from '../frames';

const IDLE_SNAPSHOT: HardwareLedSnapshot = {
  keys: ['idle', 'idle', 'unassigned', 'unassigned', 'unassigned', 'unassigned'],
  ambient: 'dark',
};

const RUNNING_SNAPSHOT: HardwareLedSnapshot = {
  keys: ['running', 'idle', 'unassigned', 'unassigned', 'unassigned', 'unassigned'],
  ambient: 'breath',
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

  it('a failed send is retried on the next update', async () => {
    let fail = true;
    const caller = makeCaller((method) =>
      method === 'v.oai.thstatus' && fail ? Promise.reject(new Error('boom')) : Promise.resolve({ ok: 1 }),
    );
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    engine.attach(caller);
    engine.update(IDLE_SNAPSHOT);
    vi.runAllTimers();
    await Promise.resolve(); // let the rejection settle
    await Promise.resolve();
    fail = false;
    caller.calls.length = 0;
    engine.update({ ...IDLE_SNAPSHOT }); // identical content
    vi.runAllTimers();
    expect(methods(caller.calls)).toEqual(['v.oai.thstatus']);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameLoop } from './dock-shell-frames';

describe('createFrameLoop', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafCallbacks.delete(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('finishes a motion through the timer when the window stops producing frames', () => {
    const loop = createFrameLoop();
    let last = 0;
    loop.start((elapsed) => {
      last = elapsed;
      return elapsed >= 200;
    });
    vi.advanceTimersByTime(1000);
    expect(last).toBeGreaterThanOrEqual(200);
    expect(loop.active).toBe(false);
  });

  it('steps once per frame when frames arrive, without a second timer step', () => {
    const loop = createFrameLoop();
    const steps: number[] = [];
    loop.start((elapsed) => {
      steps.push(elapsed);
      return steps.length >= 3;
    });
    for (let i = 0; i < 3; i++) {
      const [[id, cb]] = [...rafCallbacks];
      rafCallbacks.delete(id);
      cb(performance.now() + 16);
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(500);
    expect(steps).toHaveLength(3);
  });

  it('cancel stops both the frame and the timer', () => {
    const loop = createFrameLoop();
    const step = vi.fn(() => false);
    loop.start(step);
    loop.cancel();
    vi.advanceTimersByTime(1000);
    expect(step).not.toHaveBeenCalled();
    expect(rafCallbacks.size).toBe(0);
    expect(loop.active).toBe(false);
  });
});

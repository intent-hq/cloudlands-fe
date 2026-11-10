import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installAnimationFrames, type AnimationFrames } from '../../../test/animation-frames';
import { scheduleLayoutRead, scheduleLayoutWrite } from '../layout-phases';

describe('layout-phases', () => {
  let frames: AnimationFrames;

  beforeEach(() => {
    frames = installAnimationFrames({ afterCallback: () => {} });
  });

  afterEach(() => {
    // Drain any pending tasks so state does not leak across tests.
    frames.runFrames(10);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs all reads before all writes within one frame, regardless of scheduling order', () => {
    const order: string[] = [];
    scheduleLayoutWrite(() => order.push('write-1'));
    scheduleLayoutRead(() => order.push('read-1'));
    scheduleLayoutWrite(() => order.push('write-2'));
    scheduleLayoutRead(() => order.push('read-2'));

    expect(order).toEqual([]);
    frames.runFrame();
    expect(order).toEqual(['read-1', 'read-2', 'write-1', 'write-2']);
  });

  it('coalesces all tasks into a single animation frame', () => {
    scheduleLayoutRead(() => {});
    scheduleLayoutRead(() => {});
    scheduleLayoutWrite(() => {});
    expect(frames.pending).toBe(1);
  });

  it('lets a read schedule a write into the same frame', () => {
    const order: string[] = [];
    scheduleLayoutRead(() => {
      order.push('read');
      scheduleLayoutWrite(() => order.push('write'));
    });
    frames.runFrame();
    expect(order).toEqual(['read', 'write']);
  });

  it('lets a read schedule another read into the same frame', () => {
    const order: string[] = [];
    scheduleLayoutRead(() => {
      order.push('read-1');
      scheduleLayoutRead(() => order.push('read-2'));
    });
    scheduleLayoutWrite(() => order.push('write'));
    frames.runFrame();
    expect(order).toEqual(['read-1', 'read-2', 'write']);
  });

  it('defers a read scheduled during the write phase to the next frame', () => {
    const order: string[] = [];
    scheduleLayoutWrite(() => {
      order.push('write');
      scheduleLayoutRead(() => order.push('late-read'));
    });

    frames.runFrame();
    expect(order).toEqual(['write']);
    expect(frames.pending).toBe(1);

    frames.runFrame();
    expect(order).toEqual(['write', 'late-read']);
  });

  it('cancel prevents a task from running', () => {
    const read = vi.fn();
    const write = vi.fn();
    const cancelRead = scheduleLayoutRead(read);
    const cancelWrite = scheduleLayoutWrite(write);
    cancelRead();
    cancelWrite();
    frames.runFrame();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps running remaining tasks when one throws', () => {
    // Failures are rethrown via queueMicrotask; swallow them here so the
    // test runner does not report an unhandled error.
    const microtaskSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb: VoidFunction) => {
        try {
          cb();
        } catch {
          // expected
        }
      });
    const order: string[] = [];
    scheduleLayoutRead(() => {
      throw new Error('boom');
    });
    scheduleLayoutRead(() => order.push('read-2'));
    scheduleLayoutWrite(() => order.push('write'));
    expect(() => frames.runFrame()).not.toThrow();
    expect(order).toEqual(['read-2', 'write']);
    expect(microtaskSpy).toHaveBeenCalledTimes(1);
    microtaskSpy.mockRestore();
  });

  it('supports synchronously-invoking rAF stubs without stranding the queue', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    });
    const order: string[] = [];
    scheduleLayoutRead(() => order.push('read'));
    expect(order).toEqual(['read']);
    scheduleLayoutWrite(() => order.push('write'));
    expect(order).toEqual(['read', 'write']);
  });

  it('keeps a write cancelled and rescheduled earlier in the frame in that frame', () => {
    const order: string[] = [];
    // Tweens tick in their own frame callback, queued before the layout frame.
    requestAnimationFrame(() => {
      order.push('tick');
      cancel();
      scheduleLayoutWrite(() => order.push('fresh'));
    });
    const cancel = scheduleLayoutWrite(() => order.push('stale'));

    frames.runFrame();
    expect(order).toEqual(['tick', 'fresh']);
    expect(frames.pending).toBe(0);
  });

  it('keeps a frame armed for tasks queued after the last pending task was cancelled', () => {
    const order: string[] = [];
    const cancelRead = scheduleLayoutRead(() => order.push('stale'));
    cancelRead();
    scheduleLayoutRead(() => order.push('read'));
    scheduleLayoutWrite(() => order.push('write'));
    expect(frames.pending).toBe(1);

    frames.runFrame();
    expect(order).toEqual(['read', 'write']);
    expect(frames.pending).toBe(0);
  });
});

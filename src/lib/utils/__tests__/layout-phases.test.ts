import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleLayoutRead, scheduleLayoutWrite } from '../layout-phases';

describe('layout-phases', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
  });

  afterEach(() => {
    // Drain any pending tasks so state does not leak across tests.
    flushFrames();
    rafSpy.mockRestore();
  });

  function flushFrames() {
    let guard = 0;
    while (rafCallbacks.length > 0 && guard < 10) {
      const batch = rafCallbacks;
      rafCallbacks = [];
      for (const cb of batch) cb(performance.now());
      guard += 1;
    }
  }

  it('runs all reads before all writes within one frame, regardless of scheduling order', () => {
    const order: string[] = [];
    scheduleLayoutWrite(() => order.push('write-1'));
    scheduleLayoutRead(() => order.push('read-1'));
    scheduleLayoutWrite(() => order.push('write-2'));
    scheduleLayoutRead(() => order.push('read-2'));

    expect(order).toEqual([]);
    flushFrames();
    expect(order).toEqual(['read-1', 'read-2', 'write-1', 'write-2']);
  });

  it('coalesces all tasks into a single animation frame', () => {
    scheduleLayoutRead(() => {});
    scheduleLayoutRead(() => {});
    scheduleLayoutWrite(() => {});
    expect(rafCallbacks).toHaveLength(1);
  });

  it('lets a read schedule a write into the same frame', () => {
    const order: string[] = [];
    scheduleLayoutRead(() => {
      order.push('read');
      scheduleLayoutWrite(() => order.push('write'));
    });
    flushFrames();
    expect(order).toEqual(['read', 'write']);
  });

  it('lets a read schedule another read into the same frame', () => {
    const order: string[] = [];
    scheduleLayoutRead(() => {
      order.push('read-1');
      scheduleLayoutRead(() => order.push('read-2'));
    });
    scheduleLayoutWrite(() => order.push('write'));
    flushFrames();
    expect(order).toEqual(['read-1', 'read-2', 'write']);
  });

  it('defers a read scheduled during the write phase to the next frame', () => {
    const order: string[] = [];
    scheduleLayoutWrite(() => {
      order.push('write');
      scheduleLayoutRead(() => order.push('late-read'));
    });

    const frame = rafCallbacks;
    rafCallbacks = [];
    for (const cb of frame) cb(performance.now());
    expect(order).toEqual(['write']);
    expect(rafCallbacks).toHaveLength(1);

    flushFrames();
    expect(order).toEqual(['write', 'late-read']);
  });

  it('cancel prevents a task from running', () => {
    const read = vi.fn();
    const write = vi.fn();
    const cancelRead = scheduleLayoutRead(read);
    const cancelWrite = scheduleLayoutWrite(write);
    cancelRead();
    cancelWrite();
    flushFrames();
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
    expect(() => flushFrames()).not.toThrow();
    expect(order).toEqual(['read-2', 'write']);
    expect(microtaskSpy).toHaveBeenCalledTimes(1);
    microtaskSpy.mockRestore();
  });

  it('supports synchronously-invoking rAF stubs without stranding the queue', () => {
    rafSpy.mockImplementation((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    });
    const order: string[] = [];
    scheduleLayoutRead(() => order.push('read'));
    expect(order).toEqual(['read']);
    scheduleLayoutWrite(() => order.push('write'));
    expect(order).toEqual(['read', 'write']);
  });
});

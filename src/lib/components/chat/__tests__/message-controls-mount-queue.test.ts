import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queueMessageControls } from '../message-controls-mount-queue';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

it('spreads 198 prepended controls across frames, prioritizing visible messages', () => {
  const mounted: number[] = [];
  const pending = Array.from({ length: 198 }, (_, i) =>
    queueMessageControls(() => mounted.push(i)),
  );
  pending[197].prioritize();
  frame();
  expect(mounted).toEqual([197, 0, 1, 2]);
  while (frames.size) {
    const count = mounted.length;
    frame();
    expect(mounted.length - count).toBeLessThanOrEqual(4);
  }
  expect(new Set(mounted).size).toBe(198);
  pending.forEach((entry) => entry.cancel());
});

it('lets interaction mount immediately once and cancels destroyed pending controls', () => {
  const mounted = vi.fn();
  const interacted = queueMessageControls(mounted);
  const cancelled = queueMessageControls(mounted);
  interacted.mountNow();
  interacted.mountNow();
  cancelled.cancel();
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  frame();
  expect(mounted).toHaveBeenCalledTimes(1);
});

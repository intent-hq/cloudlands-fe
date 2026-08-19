import { describe, expect, it, vi } from 'vitest';
import { createLayoutStableRevealScheduler } from './layout-stable-reveal';

function rect(left: number, right: number): DOMRect {
  return { left, right, width: right - left } as DOMRect;
}

describe('createLayoutStableRevealScheduler', () => {
  it('reveals only after mounted geometry is stable for two committed frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    const target = document.createElement('div');
    let targetRight = 700;
    container.getBoundingClientRect = () => rect(0, 400);
    target.getBoundingClientRect = () => rect(400, targetRight);
    const reveal = vi.fn();
    const scheduler = createLayoutStableRevealScheduler();

    scheduler.schedule({
      resolveElements: () => ({ container, target }),
      isCurrent: () => true,
      reveal,
    });
    frames.shift()?.(0);
    targetRight = 800;
    frames.shift()?.(16);
    frames.shift()?.(32);
    expect(reveal).not.toHaveBeenCalled();
    frames.shift()?.(48);
    expect(reveal).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('cancels stale work and reports a target removed during scheduling', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    const target = document.createElement('div');
    container.getBoundingClientRect = () => rect(0, 400);
    target.getBoundingClientRect = () => rect(500, 800);
    let mounted = true;
    const removed = vi.fn();
    const reveal = vi.fn();
    const scheduler = createLayoutStableRevealScheduler();

    scheduler.schedule({
      resolveElements: () => (mounted ? { container, target } : null),
      isCurrent: () => true,
      reveal,
      onTargetRemoved: removed,
    });
    frames.shift()?.(0);
    mounted = false;
    frames.shift()?.(16);
    expect(removed).toHaveBeenCalledOnce();
    expect(reveal).not.toHaveBeenCalled();
    scheduler.cancel();
    vi.unstubAllGlobals();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProximityHover,
  nearestItemIndex,
  proximityItem,
  type ItemRect,
} from './proximity-hover.svelte';

const rects: ItemRect[] = [
  { top: 16, left: 8, width: 100, height: 24 },
  { top: 48, left: 8, width: 100, height: 24 },
];

describe('nearestItemIndex', () => {
  it('selects the closest row from the gap between rows', () => {
    expect(nearestItemIndex({ x: 20, y: 43 }, rects)).toBe(0);
    expect(nearestItemIndex({ x: 20, y: 45 }, rects)).toBe(1);
  });

  it('selects the first row while the pointer is in container padding', () => {
    expect(nearestItemIndex({ x: 20, y: 4 }, rects)).toBe(0);
  });

  it('returns null for an empty item list', () => {
    expect(nearestItemIndex({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('createProximityHover', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('measures registered items, tracks pointer sessions, and allows keyboard override', () => {
    const container = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 140,
      height: 100,
    } as DOMRect);
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({
      top: 116,
      left: 58,
      width: 100,
      height: 24,
    } as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({
      top: 148,
      left: 58,
      width: 100,
      height: 24,
    } as DOMRect);

    const hover = createProximityHover(container);
    const firstAction = proximityItem(first, { hover, index: 0 });
    const secondAction = proximityItem(second, { hover, index: 1 });
    expect(hover.itemRects).toEqual(rects);

    container.dispatchEvent(new Event('pointerenter'));
    container.dispatchEvent(new MouseEvent('pointermove', { clientX: 70, clientY: 151 }));
    expect(hover.sessionId).toBe(1);
    expect(hover.activeIndex).toBe(1);

    hover.setActiveIndex(0);
    expect(hover.activeIndex).toBe(0);
    container.dispatchEvent(new Event('pointerleave'));
    expect(hover.activeIndex).toBeNull();

    firstAction?.destroy?.();
    secondAction?.destroy?.();
    hover.destroy();
  });
});

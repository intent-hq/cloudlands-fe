import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { HudTakeoverTask } from '$store/renderer/slices/hud/hud-selectors';
import { createTakeoverMapDrag } from './hud-takeover-drag.svelte';
import { HUD_TAKEOVER_ZOOM_MAX, HUD_TAKEOVER_ZOOM_MIN } from './hud-takeover-layout';
import { createTakeoverMapState } from './hud-takeover-map.svelte';

/** Dependency chain t1→…→tN spanning columns 1..N on row 0. */
function chainTasks(n: number): HudTakeoverTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    title: `T${i + 1}`,
    status: 'in_progress',
    agents: [],
    report: null,
    ...(i > 0 ? { dependsOn: [`t${i}`] } : {}),
  }));
}

/** Map state measured against a 1000×600 viewport (jsdom-free fake clip). */
function measuredMap(tasks: HudTakeoverTask[], key = 'ws-1') {
  const map = createTakeoverMapState(() => tasks);
  map.measure(key, { clientWidth: 1000, clientHeight: 600 } as HTMLElement);
  return map;
}

describe('createTakeoverMapState zoom', () => {
  it('defaults to scale 1 for every display — even a graph wider than the viewport', () => {
    // Chain t1..t5 (corridor-only → pitch 192): half-extent 5·192+90 = 1050px vs the 500px half-viewport.
    const map = measuredMap(chainTasks(5));
    expect(map.scale).toBe(1);
    expect(map.panTransform).toBe('translate(0px, 0px)');
  });

  it('steps multiplicatively and clamps at the zoom range ends', () => {
    const map = measuredMap(chainTasks(1));
    const zoomedIn: number[] = [];
    for (let i = 0; i < 5; i++) {
      map.zoomIn();
      zoomedIn.push(map.scale);
    }
    // ×1.25 per step, rounded to 3 decimals, clamped at the max.
    expect(zoomedIn).toEqual([1.25, 1.563, 1.954, 2, 2]);
    expect(map.canZoomIn).toBe(false);
    expect(map.canZoomOut).toBe(true);

    map.zoomReset();
    const zoomedOut: number[] = [];
    for (let i = 0; i < 8; i++) {
      map.zoomOut();
      zoomedOut.push(map.scale);
    }
    expect(zoomedOut).toEqual([0.8, 0.64, 0.512, 0.41, 0.328, 0.262, 0.25, 0.25]);
    expect(map.canZoomOut).toBe(false);
    expect(map.canZoomIn).toBe(true);
  });

  it('zoomReset returns to 1; zoomFit fits the occupied cells to the viewport', () => {
    const map = measuredMap(chainTasks(5));
    map.zoomFit();
    // 500/1050 = 0.476 (3 decimals).
    expect(map.scale).toBe(0.476);
    expect(map.panTransform).toBe('translate(0px, 0px) scale(0.476)');
    map.zoomReset();
    expect(map.scale).toBe(1);
  });

  it('zoomFit may drop below the old 0.45 floor, clamped at the zoom minimum', () => {
    const map = measuredMap(chainTasks(30));
    map.zoomFit();
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);
  });

  it('zoomFit keeps 1:1 while the viewport is unmeasured', () => {
    const map = createTakeoverMapState(() => chainTasks(30));
    map.zoomFit();
    expect(map.scale).toBe(1);
  });

  it('resets the zoom to 1 per display (same keying as measure)', () => {
    const clip = { clientWidth: 1000, clientHeight: 600 } as HTMLElement;
    const map = measuredMap(chainTasks(5));
    map.zoomOut();
    expect(map.scale).toBe(0.8);
    // Same display key: no re-measure, zoom untouched.
    map.measure('ws-1', clip);
    expect(map.scale).toBe(0.8);
    // New display: back to 100%.
    map.measure('ws-2', clip);
    expect(map.scale).toBe(1);
    // Idle reset ('') also returns to 1:1.
    map.zoomOut();
    map.measure('', null);
    expect(map.scale).toBe(1);
  });

  it('needsPan engages at 1:1 for a far changed cell on a large graph', () => {
    const map = measuredMap(chainTasks(5));
    // t5 at (5,0): cellNeedsPan true and the chain overflows at scale 1.
    expect(map.needsPan('t5')).toBe(true);
  });

  it('needsPan is latched per display: manual zoom never flips it', () => {
    const map = measuredMap(chainTasks(5));
    expect(map.needsPan('t5')).toBe(true);
    // Fitting the whole graph on screen must NOT flip the decision — the
    // overlay's syncAutoPan $effect would re-key and reset the user's pan.
    map.zoomFit();
    expect(map.needsPan('t5')).toBe(true);
    // Zooming back in must not re-arm it as a "new" decision either.
    map.zoomReset();
    map.zoomIn();
    expect(map.needsPan('t5')).toBe(true);

    // The inverse holds too: a graph that fits at the 1:1 open zoom never
    // gains an auto-pan when the user zooms in past the viewport. t3 at
    // (3,0) is a "far" cell (|x| ≥ 3) but half-extent 666px ≤ the 700px
    // half-viewport, so the open-time decision is false — and stays false
    // even when zooming in makes the chain overflow.
    const wide = createTakeoverMapState(() => chainTasks(3));
    wide.measure('ws-2', { clientWidth: 1400, clientHeight: 600 } as HTMLElement);
    expect(wide.needsPan('t3')).toBe(false);
    wide.zoomIn();
    wide.zoomIn();
    expect(wide.needsPan('t3')).toBe(false);
  });

  it('the drag controller divides pointer deltas by the current zoom', () => {
    const map = measuredMap(chainTasks(5));
    map.zoomOut();
    const node = document.createElement('div');
    map.drag.attach(node);

    const pointer = (type: string, x: number, y: number) => {
      node.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0 }));
      flushSync();
    };
    pointer('pointerdown', 500, 300);
    pointer('pointermove', 450, 280);
    pointer('pointerup', 450, 280);

    // Content pan = delta/0.8; rendered translate scales back to 1:1 on screen.
    expect(map.drag.pan).toEqual({ x: 62.5, y: 25 });
    expect(map.panTransform).toBe('translate(-50px, -20px) scale(0.8)');
  });
});

describe('createTakeoverMapState wheel zoom', () => {
  it('wheel-up zooms in and wheel-down zooms out by the wheel step, centered pointer keeps the pan', () => {
    const map = measuredMap(chainTasks(1));
    map.wheelZoom(-100, { x: 0, y: 0 });
    expect(map.scale).toBe(1.1);
    map.wheelZoom(-100, { x: 0, y: 0 });
    expect(map.scale).toBe(1.21);
    map.wheelZoom(100, { x: 0, y: 0 });
    map.wheelZoom(100, { x: 0, y: 0 });
    expect(map.scale).toBe(1);
    expect(map.drag.pan).toEqual({ x: 0, y: 0 });
    // deltaY 0 (pure horizontal wheel) is a no-op.
    map.wheelZoom(0, { x: 200, y: 0 });
    expect(map.scale).toBe(1);
  });

  it('clamps to the same range as the zoom buttons and freezes the pan at the limits', () => {
    const map = measuredMap(chainTasks(1));
    for (let i = 0; i < 12; i++) map.wheelZoom(-100, { x: 50, y: 50 });
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MAX);
    const atMax = { ...map.drag.pan };
    map.wheelZoom(-100, { x: 50, y: 50 });
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MAX);
    expect(map.drag.pan).toEqual(atMax);

    for (let i = 0; i < 30; i++) map.wheelZoom(100, { x: 50, y: 50 });
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);
    const atMin = { ...map.drag.pan };
    map.wheelZoom(100, { x: 50, y: 50 });
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);
    expect(map.drag.pan).toEqual(atMin);
  });

  it('anchors at the pointer: the map point under the cursor stays put', () => {
    const map = measuredMap(chainTasks(5));
    // Content point under a pointer p (screen px from the clip center) is
    // c = pan + p/zoom; it must survive the step: pan' = pan + p·(1/z − 1/z').
    const p = { x: 200, y: 100 };
    const before = { x: map.drag.pan.x + p.x / map.scale, y: map.drag.pan.y + p.y / map.scale };
    map.wheelZoom(-100, p);
    expect(map.scale).toBe(1.1);
    expect(map.drag.pan.x).toBeCloseTo(200 * (1 - 1 / 1.1), 6);
    expect(map.drag.pan.y).toBeCloseTo(100 * (1 - 1 / 1.1), 6);
    expect(map.drag.pan.x + p.x / map.scale).toBeCloseTo(before.x, 6);
    expect(map.drag.pan.y + p.y / map.scale).toBeCloseTo(before.y, 6);

    // Zooming back out through the same pointer returns the anchor too.
    map.wheelZoom(100, p);
    expect(map.scale).toBe(1);
    expect(map.drag.pan.x).toBeCloseTo(0, 6);
    expect(map.drag.pan.y).toBeCloseTo(0, 6);
  });

  it('clamps the anchored pan to the existing pan bounds', () => {
    // chainTasks(5): occupied x 0..5 on row 0, ring +1 → bounds ±(6·192) / ±192.
    const map = measuredMap(chainTasks(5));
    map.wheelZoom(-100, { x: 100_000, y: 100_000 });
    expect(map.scale).toBe(1.1);
    expect(map.drag.pan).toEqual({ x: 1152, y: 192 });
  });

  it('a wheel step cancels the auto-pan glide (manual interaction wins)', () => {
    const map = measuredMap(chainTasks(5));
    map.drag.syncAutoPan('ws-1', { x: 3, y: 0 }, 0);
    expect(map.drag.animate).toBe(true);
    expect(map.drag.pan).toEqual({ x: 576, y: 0 });
    map.wheelZoom(-100, { x: 0, y: 0 });
    expect(map.drag.animate).toBe(false);
    expect(map.drag.pan).toEqual({ x: 576, y: 0 });
  });

  it('a wheel step at the zoom limit still cancels a pending auto-pan', () => {
    vi.useFakeTimers();
    try {
      const map = measuredMap(chainTasks(5));
      for (let i = 0; i < 12; i++) map.wheelZoom(-100, { x: 0, y: 0 });
      expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MAX);
      map.drag.syncAutoPan('ws-1', { x: 3, y: 0 }, 1000);
      const pinned = { ...map.drag.pan };
      map.wheelZoom(-100, { x: 0, y: 0 });
      expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MAX);
      expect(map.drag.animate).toBe(false);
      expect(map.drag.pan).toEqual(pinned);
      // The scheduled glide was cancelled: the pan never jumps to the far cell.
      vi.advanceTimersByTime(1000);
      expect(map.drag.pan).toEqual(pinned);
    } finally {
      vi.useRealTimers();
    }
  });

  it('attachWheel consumes the event and feeds pointer-anchored steps', () => {
    const map = measuredMap(chainTasks(5));
    const node = document.createElement('div');
    const detach = map.attachWheel(node);

    // jsdom rects are all-zero, so the clip center is (0,0) and the pointer
    // offset is just clientX/clientY.
    const wheel = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, clientX: 200, clientY: 100, cancelable: true });
      node.dispatchEvent(e);
      flushSync();
      return e;
    };
    expect(wheel(-120).defaultPrevented).toBe(true);
    expect(map.scale).toBe(1.1);
    expect(map.drag.pan.x).toBeCloseTo(200 * (1 - 1 / 1.1), 6);
    expect(wheel(120).defaultPrevented).toBe(true);
    expect(map.scale).toBe(1);

    // Still consumed at a range limit (no page scrolling over the map).
    for (let i = 0; i < 30; i++) wheel(120);
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);
    expect(wheel(120).defaultPrevented).toBe(true);
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);

    detach();
    wheel(-120);
    expect(map.scale).toBe(HUD_TAKEOVER_ZOOM_MIN);
  });
});

describe('createTakeoverMapDrag syncAutoPan pitch keying', () => {
  const bounds = { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 };

  it('re-pans when the pitch changes for the same workspace/cell pair', () => {
    let pitch = 196;
    const drag = createTakeoverMapDrag(
      () => bounds,
      () => 1,
      () => pitch,
    );
    drag.syncAutoPan('ws-1', { x: 3, y: 1 }, 0);
    expect(drag.pan).toEqual({ x: 588, y: 196 });
    // Same pair at the same pitch: deduped no-op.
    drag.syncAutoPan('ws-1', { x: 3, y: 1 }, 0);
    expect(drag.pan).toEqual({ x: 588, y: 196 });
    // Lane growth widened the pitch: the cell's px position shifted, so the
    // same pair must re-key and re-center instead of deduping stale.
    pitch = 232;
    drag.syncAutoPan('ws-1', { x: 3, y: 1 }, 0);
    expect(drag.pan).toEqual({ x: 696, y: 232 });
    drag.destroy();
  });

  it('a pitch change with no target cell never resets a manual pan', () => {
    let pitch = 196;
    const drag = createTakeoverMapDrag(
      () => bounds,
      () => 1,
      () => pitch,
    );
    drag.syncAutoPan('ws-1', null, 0);

    const node = document.createElement('div');
    const detach = drag.attach(node);
    const pointer = (type: string, x: number, y: number) => {
      node.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0 }));
      flushSync();
    };
    pointer('pointerdown', 500, 300);
    pointer('pointermove', 450, 280);
    pointer('pointerup', 450, 280);
    expect(drag.pan).toEqual({ x: 50, y: 20 });

    // A reactive re-run after a pitch change (deps updated) with no auto-pan
    // target stays deduped — the manual drag survives.
    pitch = 232;
    drag.syncAutoPan('ws-1', null, 0);
    expect(drag.pan).toEqual({ x: 50, y: 20 });

    detach();
    drag.destroy();
  });
});

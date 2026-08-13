import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import type { HudTakeoverTask } from '$store/renderer/slices/hud/hud-selectors';
import { HUD_TAKEOVER_ZOOM_MIN } from './hud-takeover-layout';
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
    // Chain t1..t5: half-extent 5·192+90 = 1050px vs the 500px half-viewport.
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
    // Fitted (0.476) the whole graph is visible — no auto-pan.
    map.zoomFit();
    expect(map.needsPan('t5')).toBe(false);
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

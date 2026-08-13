import { describe, expect, it } from 'vitest';
import {
  bannerDelay,
  bannerOutDelay,
  bannerScrollDurationS,
  canvasBounds,
  cellNeedsPan,
  clampTakeoverPan,
  clampZoom,
  dependencyGraphLayout,
  edgeLinePx,
  emptyCellCoords,
  fitScale,
  HUD_TAKEOVER_BANNER_IN_S,
  HUD_TAKEOVER_BANNER_SCROLL_HOLD_S,
  HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S,
  HUD_TAKEOVER_CELL_PX,
  HUD_TAKEOVER_PITCH_PX,
  HUD_TAKEOVER_SPEC_NODE_ID,
  HUD_TAKEOVER_ZOOM_MAX,
  HUD_TAKEOVER_ZOOM_MIN,
  takeoverFrameFrom,
  takeoverGraphFits,
  takeoverPanBounds,
} from './hud-takeover-layout';
import { takeoverEdgeBoxPx } from './hud-takeover-edges';
import {
  HUD_TAKEOVER_ATTENTION_DWELL_BASE_MS,
  HUD_TAKEOVER_ATTENTION_DWELL_PER_CHAR_MS,
  HUD_TAKEOVER_DWELL_MIN_MS,
} from './hud-takeover-queue';

describe('hud-takeover-layout', () => {
  it('flags far cells for pan per the mock thresholds', () => {
    expect(cellNeedsPan({ x: 0, y: -1 })).toBe(false);
    expect(cellNeedsPan({ x: 2, y: 1 })).toBe(false);
    expect(cellNeedsPan({ x: 3, y: 0 })).toBe(true);
    expect(cellNeedsPan({ x: 0, y: 2 })).toBe(true);
    expect(cellNeedsPan({ x: -3, y: -2 })).toBe(true);
  });

  it('bounds include a dashed ring and never shrink below the base viewport', () => {
    expect(canvasBounds([])).toEqual({ minX: -2, maxX: 2, minY: -1, maxY: 1 });
    expect(canvasBounds([{ x: 3, y: 2 }])).toEqual({ minX: -2, maxX: 4, minY: -1, maxY: 3 });
  });

  it('empty cells fill the canvas minus the occupied coords and the spec origin', () => {
    const empties = emptyCellCoords([{ x: 1, y: 0 }]);
    const keys = new Set(empties.map((c) => `${c.x},${c.y}`));
    // Base viewport 5×3 minus spec (0,0) and the one task cell.
    expect(empties).toHaveLength(13);
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('1,0')).toBe(false);
    expect(keys.has('-2,-1')).toBe(true);
    expect(keys.has('2,1')).toBe(true);
  });

  describe('dependencyGraphLayout (layered left→right DAG)', () => {
    const t = (id: string, dependsOn?: string[], conflictsWith?: string[]) => ({
      id,
      dependsOn,
      conflictsWith,
    });

    it('is deterministic: same input yields the same coords and edges', () => {
      const tasks = [t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'], ['e']), t('e', ['ghost'])];
      const one = dependencyGraphLayout(tasks);
      const two = dependencyGraphLayout(tasks.map((task) => ({ ...task })));
      expect([...one.coords.entries()]).toEqual([...two.coords.entries()]);
      expect(one.edges).toEqual(two.edges);
    });

    it('layers a chain by longest path: roots at x=1, dependents rightward', () => {
      const { coords, edges } = dependencyGraphLayout([t('a'), t('b', ['a']), t('c', ['b'])]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('b')).toEqual({ x: 2, y: 0 });
      expect(coords.get('c')).toEqual({ x: 3, y: 0 });
      expect(edges).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
        { from: 'a', to: 'b', kind: 'dep' },
        { from: 'b', to: 'c', kind: 'dep' },
      ]);
    });

    it('diamond: the join sits at 1 + max dep column, deps share a column on distinct rows', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'])]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('b')!.x).toBe(2);
      expect(coords.get('c')!.x).toBe(2);
      expect(coords.get('b')!.y).not.toBe(coords.get('c')!.y);
      expect(coords.get('d')!.x).toBe(3);
    });

    it('longest path wins over the shortest dep edge', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b', ['a']), t('c', ['b']), t('d', ['a', 'c'])]);
      expect(coords.get('d')!.x).toBe(4);
    });

    it('orders a column by the barycenter of dependency rows, not input order', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b'), t('c', ['b']), t('d', ['a'])]);
      expect(coords.get('a')).toEqual({ x: 1, y: -1 });
      expect(coords.get('b')).toEqual({ x: 1, y: 0 });
      // d follows its dep a to the upper row even though c precedes it in input.
      expect(coords.get('d')).toEqual({ x: 2, y: -1 });
      expect(coords.get('c')).toEqual({ x: 2, y: 0 });
    });

    it('stacks islands below the spec component with a one-cell gutter', () => {
      const { coords, edges } = dependencyGraphLayout([t('a'), t('e', ['ghost']), t('f', ['e'])]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('e')).toEqual({ x: 1, y: 2 });
      expect(coords.get('f')).toEqual({ x: 2, y: 2 });
      // Dangling-only deps anchor the island: no spec edge, no edge to the missing id.
      expect(edges).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
        { from: 'e', to: 'f', kind: 'dep' },
      ]);
    });

    it('spec edges only for truly empty dependsOn; duplicate dep ids collapse to one edge', () => {
      const { edges } = dependencyGraphLayout([t('a'), t('b', ['a', 'a'])]);
      expect(edges).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
        { from: 'a', to: 'b', kind: 'dep' },
      ]);
    });

    it('dedupes symmetric conflict pairs and drops dangling conflict refs', () => {
      const { edges } = dependencyGraphLayout([t('a', [], ['b', 'ghost']), t('b', [], ['a'])]);
      expect(edges.filter((e) => e.kind === 'conflict')).toEqual([
        { from: 'a', to: 'b', kind: 'conflict' },
      ]);
    });

    it('never overlaps cells and never occupies the spec origin', () => {
      const tasks = [
        t('a'),
        t('b'),
        t('c', ['a', 'b']),
        t('d', ['c']),
        t('e', ['c']),
        t('f', ['d', 'e'], ['g']),
        t('g', ['ghost']),
        t('h', ['g']),
        t('i', ['ghost2']),
      ];
      const { coords } = dependencyGraphLayout(tasks);
      const keys = [...coords.values()].map(({ x, y }) => `${x},${y}`);
      expect(new Set(keys).size).toBe(tasks.length);
      expect(keys).not.toContain('0,0');
      for (const { x, y } of coords.values()) {
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(1);
      }
    });

    it('defensively terminates on a dependency cycle (rejected daemon-side)', () => {
      const { coords } = dependencyGraphLayout([t('a', ['b']), t('b', ['a'])]);
      expect(coords.size).toBe(2);
      const keys = new Set([...coords.values()].map(({ x, y }) => `${x},${y}`));
      expect(keys.size).toBe(2);
    });

    it('coords feed the existing lattice helpers unchanged', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b', ['a']), t('c', ['b']), t('d', ['c'])]);
      const list = [...coords.values()];
      expect(canvasBounds(list)).toEqual({ minX: -2, maxX: 5, minY: -1, maxY: 1 });
      expect(takeoverPanBounds(list).maxX).toBe(5 * HUD_TAKEOVER_PITCH_PX);
      const empties = new Set(emptyCellCoords(list).map(({ x, y }) => `${x},${y}`));
      expect(empties.has('0,0')).toBe(false);
      expect(empties.has('1,0')).toBe(false);
      expect(empties.has('1,1')).toBe(true);
    });
  });

  describe('edgeLinePx (cell-border to cell-border px lines)', () => {
    it('trims a horizontal neighbor edge to the 180px cell borders with the arrow gap', () => {
      const line = edgeLinePx({ x: 0, y: 0 }, { x: 1, y: 0 });
      expect(line).toEqual({
        x1: HUD_TAKEOVER_CELL_PX / 2,
        y1: 0,
        x2: HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX / 2 - 2,
        y2: 0,
      });
    });

    it('trims diagonals at the square cell boundary (Chebyshev exit)', () => {
      const line = edgeLinePx({ x: 0, y: 0 }, { x: 1, y: 1 });
      // Unit direction (√2/2, √2/2); exit at 90px along the dominant axis.
      expect(line!.x1).toBeCloseTo(90, 0);
      expect(line!.y1).toBeCloseTo(90, 0);
      expect(line!.x2).toBeCloseTo(HUD_TAKEOVER_PITCH_PX - 92, 0);
      expect(line!.y2).toBeCloseTo(HUD_TAKEOVER_PITCH_PX - 92, 0);
    });

    it('returns null on degenerate pairs (same coord — no visible segment)', () => {
      expect(edgeLinePx({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
    });
  });

  describe('takeoverEdgeBoxPx (edge SVG canvas box)', () => {
    it('spans the base canvas (x −2…2, y −1…1) when no cells extend it', () => {
      expect(takeoverEdgeBoxPx([])).toEqual({
        left: -2 * HUD_TAKEOVER_PITCH_PX - 90,
        top: -1 * HUD_TAKEOVER_PITCH_PX - 90,
        width: 4 * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
        height: 2 * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
      });
    });

    it('grows with the dashed ring around far occupied cells', () => {
      // Cell at (4, 3) → ring pushes bounds to x −2…5, y −1…4.
      expect(takeoverEdgeBoxPx([{ x: 4, y: 3 }])).toEqual({
        left: -2 * HUD_TAKEOVER_PITCH_PX - 90,
        top: -1 * HUD_TAKEOVER_PITCH_PX - 90,
        width: 7 * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
        height: 5 * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
      });
    });
  });

  describe('fitScale (manual zoom-to-fit target)', () => {
    const viewport = { width: 1000, height: 600 };

    it('keeps 1:1 when the occupied cells already fit the viewport', () => {
      expect(fitScale([{ x: 1, y: 0 }], viewport)).toBe(1);
      expect(fitScale([], viewport)).toBe(1);
    });

    it('shrinks a wide graph until the far column fits (symmetric about the origin)', () => {
      // x=4: half-extent 4·192+90 = 858px vs 500px half-viewport → ≈0.583.
      const scale = fitScale([{ x: 4, y: 0 }], viewport);
      expect(scale).toBeCloseTo(500 / 858, 3);
    });

    it('the tighter axis wins and the scale never drops below the zoom minimum', () => {
      // y=3: half-extent 666 vs 300 → ≈0.450.
      expect(fitScale([{ x: 1, y: 3 }], viewport)).toBeCloseTo(300 / 666, 3);
      expect(fitScale([{ x: 30, y: 30 }], viewport)).toBe(HUD_TAKEOVER_ZOOM_MIN);
    });

    it('fits below the old 0.45 floor so large graphs actually fit', () => {
      // x=8: half-extent 8·192+90 = 1626 vs 500 → ≈0.308 (< 0.45, > minimum).
      expect(fitScale([{ x: 8, y: 0 }], viewport)).toBeCloseTo(500 / 1626, 3);
    });

    it('an unmeasured viewport (jsdom, pre-layout) keeps the 1:1 scale', () => {
      expect(fitScale([{ x: 30, y: 0 }], { width: 0, height: 0 })).toBe(1);
    });

    it('never scales up past 1 for tiny graphs in huge viewports', () => {
      expect(fitScale([{ x: 1, y: 0 }], { width: 10_000, height: 10_000 })).toBe(1);
    });
  });

  describe('clampZoom (manual zoom range)', () => {
    it('clamps into the zoom range and rounds to 3 decimals', () => {
      expect(clampZoom(3)).toBe(HUD_TAKEOVER_ZOOM_MAX);
      expect(clampZoom(0.01)).toBe(HUD_TAKEOVER_ZOOM_MIN);
      expect(clampZoom(1)).toBe(1);
      // 1.25³ = 1.953125 → rounded for stable CSS output.
      expect(clampZoom(1.953125)).toBe(1.953);
    });
  });

  describe('takeoverGraphFits (auto-pan suppression)', () => {
    const viewport = { width: 1000, height: 600 };

    it('true when the scaled canvas sits fully inside the viewport', () => {
      expect(takeoverGraphFits([{ x: 1, y: 0 }], viewport, 1)).toBe(true);
      const coords = [{ x: 4, y: 0 }];
      expect(takeoverGraphFits(coords, viewport, fitScale(coords, viewport))).toBe(true);
    });

    it('false when the floor-clamped scale still overflows or the viewport is unmeasured', () => {
      const coords = [{ x: 30, y: 0 }];
      expect(takeoverGraphFits(coords, viewport, fitScale(coords, viewport))).toBe(false);
      expect(takeoverGraphFits([{ x: 1, y: 0 }], { width: 0, height: 0 }, 1)).toBe(false);
    });
  });

  describe('drag-to-pan bounds', () => {
    it('converts the canvas bounds to px camera limits', () => {
      expect(takeoverPanBounds([])).toEqual({
        minX: -2 * HUD_TAKEOVER_PITCH_PX,
        maxX: 2 * HUD_TAKEOVER_PITCH_PX,
        minY: -1 * HUD_TAKEOVER_PITCH_PX,
        maxY: 1 * HUD_TAKEOVER_PITCH_PX,
      });
      expect(takeoverPanBounds([{ x: 4, y: -3 }])).toEqual({
        minX: -2 * HUD_TAKEOVER_PITCH_PX,
        maxX: 5 * HUD_TAKEOVER_PITCH_PX,
        minY: -4 * HUD_TAKEOVER_PITCH_PX,
        maxY: 1 * HUD_TAKEOVER_PITCH_PX,
      });
    });

    it('clamps a camera offset into the bounds (cells never fully off-screen)', () => {
      const bounds = takeoverPanBounds([]);
      expect(clampTakeoverPan({ x: 0, y: 0 }, bounds)).toEqual({ x: 0, y: 0 });
      expect(clampTakeoverPan({ x: 10_000, y: -10_000 }, bounds)).toEqual({
        x: bounds.maxX,
        y: bounds.minY,
      });
      expect(clampTakeoverPan({ x: -300, y: 150 }, bounds)).toEqual({ x: -300, y: 150 });
    });
  });

  describe('takeoverFrameFrom (FLIP zoom-from transform)', () => {
    const shell = { left: 0, top: 0, width: 1600, height: 900 };

    it('computes the card-center offset from the shell center and card/frame scale', () => {
      // Frame renders at min(1560, 1600-120)=1480 × min(850, 900-120)=780.
      const card = { left: 100, top: 200, width: 296, height: 296 };
      const from = takeoverFrameFrom(shell, card);
      expect(from).not.toBeNull();
      expect(from!.x).toBeCloseTo(100 + 148 - 800); // card center X − shell center X
      expect(from!.y).toBeCloseTo(200 + 148 - 450);
      expect(from!.sx).toBeCloseTo(296 / 1480);
      expect(from!.sy).toBeCloseTo(296 / 780);
    });

    it('accounts for a shell not anchored at the viewport origin', () => {
      const offsetShell = { left: 50, top: 30, width: 1600, height: 900 };
      const card = { left: 850, top: 480, width: 200, height: 200 };
      const from = takeoverFrameFrom(offsetShell, card);
      expect(from!.x).toBeCloseTo(850 + 100 - 50 - 800);
      expect(from!.y).toBeCloseTo(480 + 100 - 30 - 450);
    });

    it('returns null on degenerate rects (hidden card / unlaid-out shell)', () => {
      expect(takeoverFrameFrom(shell, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
      expect(
        takeoverFrameFrom({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 10, height: 10 }),
      ).toBeNull();
      // Shell smaller than the frame margin → no usable frame box.
      expect(
        takeoverFrameFrom(
          { left: 0, top: 0, width: 100, height: 100 },
          { left: 0, top: 0, width: 50, height: 50 },
        ),
      ).toBeNull();
    });
  });

  describe('banner phase timeline (unfolded hold ≈ half the dwell)', () => {
    /** Fully-unfolded hold (s) = out-delay − (in-delay + typewriter wipe). */
    const holdS = (needsPan: boolean, index: number, dwellMs: number) =>
      Number(bannerOutDelay(needsPan, index, dwellMs)) -
      Number(bannerDelay(needsPan, index)) -
      HUD_TAKEOVER_BANNER_IN_S;

    it('keeps the mock unfold delays: 1.0s (3.5s when panning), +0.3s per stack', () => {
      expect(bannerDelay(false, 0)).toBe('1.0');
      expect(bannerDelay(false, 1)).toBe('1.3');
      expect(bannerDelay(true, 0)).toBe('3.5');
    });

    it('routine entry: unfolded hold is exactly half the floor dwell', () => {
      // Floor dwell 3000ms → out = 1.0 + 1.1 + 1.5 = 3.60s.
      expect(bannerOutDelay(false, 0, HUD_TAKEOVER_DWELL_MIN_MS)).toBe('3.60');
      expect(holdS(false, 0, HUD_TAKEOVER_DWELL_MIN_MS)).toBeCloseTo(
        HUD_TAKEOVER_DWELL_MIN_MS / 2000,
      );
    });

    it('attention entry: the longer dwell buys a proportionally longer hold', () => {
      // 120-char question: dwell 4000 + 60×120 = 11200ms → out = 1.0 + 1.1 + 5.6 = 7.70s.
      const dwellMs =
        HUD_TAKEOVER_ATTENTION_DWELL_BASE_MS + HUD_TAKEOVER_ATTENTION_DWELL_PER_CHAR_MS * 120;
      expect(bannerOutDelay(false, 0, dwellMs)).toBe('7.70');
      expect(holdS(false, 0, dwellMs)).toBeCloseTo(dwellMs / 2000);
    });

    it('the hold stays dwell/2 across pan pre-roll and stack stagger', () => {
      expect(holdS(true, 0, 8000)).toBeCloseTo(4);
      expect(holdS(false, 1, 8000)).toBeCloseTo(4);
      expect(bannerOutDelay(true, 0, 8000)).toBe('8.60'); // 3.5 + 1.1 + 4.0
      expect(bannerOutDelay(false, 1, 8000)).toBe('6.40'); // 1.3 + 1.1 + 4.0
    });

    it('a scroll duration shifts the fade-out by exactly the scroll', () => {
      // out = in 1.0 + wipe 1.1 + scroll 2.5 + dwell/2 4.0 = 8.60s.
      expect(bannerOutDelay(false, 0, 8000, 2.5)).toBe('8.60');
      expect(bannerOutDelay(true, 1, 8000, 2.5)).toBe('11.40'); // 3.8 + 1.1 + 2.5 + 4.0
    });

    it('scroll = 0 keeps the no-scroll fade-out byte-identical', () => {
      expect(bannerOutDelay(false, 0, 8000, 0)).toBe(bannerOutDelay(false, 0, 8000));
      expect(bannerOutDelay(true, 1, HUD_TAKEOVER_DWELL_MIN_MS, 0)).toBe(
        bannerOutDelay(true, 1, HUD_TAKEOVER_DWELL_MIN_MS),
      );
    });
  });

  describe('bannerScrollDurationS (overflow auto-scroll duration)', () => {
    it('is 0 without overflow (0 or negative px)', () => {
      expect(bannerScrollDurationS(0)).toBe(0);
      expect(bannerScrollDurationS(-40)).toBe(0);
    });

    it('scales linearly with overflow at the readable speed plus end holds', () => {
      expect(bannerScrollDurationS(150)).toBeCloseTo(
        150 / HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S + 2 * HUD_TAKEOVER_BANNER_SCROLL_HOLD_S,
      );
    });

    it('a large overflow keeps the same deterministic curve (never capped)', () => {
      expect(bannerScrollDurationS(3000)).toBeCloseTo(
        3000 / HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S + 2 * HUD_TAKEOVER_BANNER_SCROLL_HOLD_S,
      );
      expect(bannerScrollDurationS(3000)).toBeGreaterThan(bannerScrollDurationS(150));
    });

    it('the speed sits in the readable 60–90 px/s band', () => {
      expect(HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S).toBeGreaterThanOrEqual(60);
      expect(HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S).toBeLessThanOrEqual(90);
    });
  });
});

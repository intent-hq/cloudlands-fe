import { describe, expect, it } from 'vitest';
import {
  dependencyGraphLayout,
  HUD_TAKEOVER_GUTTER_MIN_PX,
  HUD_TAKEOVER_SPEC_NODE_ID,
  takeoverGutterPx,
  type HudTakeoverCellCoord,
  type HudTakeoverGraphEdge,
  type HudTakeoverGraphLayout,
} from './hud-takeover-layout';
import {
  HUD_TAKEOVER_CELL_HALF_LATTICE,
  takeoverEdgeRoutes,
  type HudTakeoverEdgeRoute,
} from './hud-takeover-routing';

const HALF = HUD_TAKEOVER_CELL_HALF_LATTICE;

const t = (id: string, dependsOn?: string[], conflictsWith?: string[]) => ({
  id,
  dependsOn,
  conflictsWith,
});

const g = (
  coords: Array<[string, HudTakeoverCellCoord]>,
  edges: HudTakeoverGraphEdge[],
): HudTakeoverGraphLayout => ({ coords: new Map(coords), edges });

/** All (axis, channel, lane, span) tuples across the routes, with bundle keys. */
const allSpans = (routes: HudTakeoverEdgeRoute[]) =>
  routes.flatMap((route) =>
    route.segments.map((seg, i) => {
      const p = route.points[i];
      const q = route.points[i + 1];
      const [lo, hi] =
        seg.axis === 'h'
          ? [Math.min(p.x, q.x), Math.max(p.x, q.x)]
          : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
      return { id: route.id, kind: route.kind, from: route.from, ...seg, lo, hi };
    }),
  );

describe('hud-takeover-routing (orthogonal edge router)', () => {
  it('routes a single spec edge as one straight border-to-border segment', () => {
    const { routes, maxLanes } = takeoverEdgeRoutes(dependencyGraphLayout([t('a')]));
    expect(routes).toEqual([
      {
        id: `${HUD_TAKEOVER_SPEC_NODE_ID}\u0000a\u0000spec`,
        kind: 'spec',
        from: HUD_TAKEOVER_SPEC_NODE_ID,
        to: 'a',
        points: [
          { x: HALF, y: 0 },
          { x: 1 - HALF, y: 0 },
        ],
        segments: [{ axis: 'h', channel: 0, lane: 0 }],
      },
    ]);
    // The only lane sits in a border corridor (integer channel) — no gutter demand.
    expect(maxLanes).toBe(0);
  });

  it('bends adjacent-column row changes through the shared vertical gutter (Z shape)', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 2, y: 1 }],
      ],
      [{ from: 'a', to: 'b', kind: 'dep' }],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    expect(routes[0].points).toEqual([
      { x: 1 + HALF, y: 0 },
      { x: 1.5, y: 0 },
      { x: 1.5, y: 1 },
      { x: 2 - HALF, y: 1 },
    ]);
    expect(routes[0].segments.map((s) => `${s.axis}:${s.channel}`)).toEqual([
      'h:0',
      'v:1.5',
      'h:1',
    ]);
  });

  it('dodges same-row far targets through gutters, never crossing the row of cells', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 3, y: 0 }],
      ],
      [{ from: 'a', to: 'b', kind: 'dep' }],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    expect(routes[0].points).toEqual([
      { x: 1 + HALF, y: 0 },
      { x: 1.5, y: 0 },
      { x: 1.5, y: -0.5 },
      { x: 2.5, y: -0.5 },
      { x: 2.5, y: 0 },
      { x: 3 - HALF, y: 0 },
    ]);
    // The long horizontal run lies in the gutter above the row, not in the row corridor.
    expect(routes[0].segments[2]).toEqual({ axis: 'h', channel: -0.5, lane: 0 });
  });

  it('fan-out: exit stubs from one source bundle onto one trunk lane', () => {
    const graph = g(
      [
        ['s', { x: 1, y: 0 }],
        ['a', { x: 2, y: 0 }],
        ['b', { x: 2, y: 1 }],
      ],
      [
        { from: 's', to: 'a', kind: 'dep' },
        { from: 's', to: 'b', kind: 'dep' },
      ],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    const exitLanes = routes.map((route) => route.segments[0]);
    expect(exitLanes[0]).toEqual({ axis: 'h', channel: 0, lane: 0 });
    expect(exitLanes[1]).toEqual({ axis: 'h', channel: 0, lane: 0 });
  });

  it('bundling: same-source fan-out shares one trunk lane across overlapping gutter runs', () => {
    const graph = g(
      [
        ['s', { x: 1, y: 0 }],
        ['a', { x: 2, y: 0 }],
        ['b', { x: 2, y: 1 }],
        ['c', { x: 2, y: 2 }],
      ],
      [
        { from: 's', to: 'a', kind: 'dep' },
        { from: 's', to: 'b', kind: 'dep' },
        { from: 's', to: 'c', kind: 'dep' },
      ],
    );
    const { routes, maxLanes } = takeoverEdgeRoutes(graph);
    // The two Z routes overlap on gutter v:1.5 ([0,1] vs [0,2]) yet share lane 0.
    const gutter = allSpans(routes).filter((s) => s.axis === 'v' && s.channel === 1.5);
    expect(gutter).toHaveLength(2);
    expect(routes.every((route) => route.segments.every((s) => s.lane === 0))).toBe(true);
    expect(maxLanes).toBe(1);
  });

  it('stickiness: a cross-bundle span bumping one member off lane 0 no longer splits the trunk', () => {
    // u→v's gutter run takes lane 0 on v:1.5 over [2,3]. s→c's run ([0,2])
    // touches it at y=2, so s→c is bumped to lane 1. s→b's run ([0,1]) does
    // NOT reach the blocker — first-fit would drop it on the free lane 0,
    // splitting the s trunk into two parallel lines. Stickiness makes it
    // follow s→c onto the memoized lane 1 instead.
    const graph = g(
      [
        ['s', { x: 1, y: 0 }],
        ['b', { x: 2, y: 1 }],
        ['c', { x: 2, y: 2 }],
        ['u', { x: 1, y: 2 }],
        ['v', { x: 2, y: 3 }],
      ],
      [
        { from: 'u', to: 'v', kind: 'dep' },
        { from: 's', to: 'c', kind: 'dep' },
        { from: 's', to: 'b', kind: 'dep' },
      ],
    );
    const gutter = allSpans(takeoverEdgeRoutes(graph).routes).filter(
      (s) => s.axis === 'v' && s.channel === 1.5,
    );
    expect(gutter.find((s) => s.from === 'u')?.lane).toBe(0);
    const trunk = gutter.filter((s) => s.from === 's');
    expect(trunk).toHaveLength(2);
    expect(trunk.map((s) => s.lane)).toEqual([1, 1]);
  });

  it('stickiness: a blocked member falls back to first-fit without overwriting the memo', () => {
    // As above, s's bundle memoizes lane 1 on v:1.5 (s→c bumped by u→v).
    // u→q's conflict run then claims lane 1 over [2.5,3.5], so s→e's run
    // ([0,4]) finds its sticky lane blocked and falls back to first-fit
    // (lanes 0 and 1 both blocked ⇒ lane 2). The fallback must not overwrite
    // the memo: s→b's run ([0,1]) clears every blocker and still converges
    // on the sticky lane 1, not lane 0 or the fallback lane 2.
    const graph = g(
      [
        ['s', { x: 1, y: 0 }],
        ['b', { x: 2, y: 1 }],
        ['c', { x: 2, y: 2 }],
        ['e', { x: 2, y: 4 }],
        ['u', { x: 1, y: 2 }],
        ['v', { x: 2, y: 3 }],
        ['q', { x: 1, y: 4 }],
      ],
      [
        { from: 'u', to: 'v', kind: 'dep' },
        { from: 's', to: 'c', kind: 'dep' },
        { from: 'u', to: 'q', kind: 'conflict' },
        { from: 's', to: 'e', kind: 'dep' },
        { from: 's', to: 'b', kind: 'dep' },
      ],
    );
    const gutter = allSpans(takeoverEdgeRoutes(graph).routes).filter(
      (s) => s.axis === 'v' && s.channel === 1.5,
    );
    const laneOf = (id: string) => gutter.find((s) => s.id.startsWith(`${id}\u0000`))?.lane;
    expect(laneOf('u')).toBe(0);
    const conflictRun = gutter.find((s) => s.kind === 'conflict');
    expect(conflictRun?.lane).toBe(1);
    expect(gutter.find((s) => s.id === 's\u0000c\u0000dep')?.lane).toBe(1);
    expect(gutter.find((s) => s.id === 's\u0000e\u0000dep')?.lane).toBe(2);
    expect(gutter.find((s) => s.id === 's\u0000b\u0000dep')?.lane).toBe(1);
  });

  it('bundling: same source but different kinds are separate bundles with distinct lanes', () => {
    const graph = g(
      [
        ['s', { x: 1, y: 0 }],
        ['a', { x: 2, y: 0 }],
        ['b', { x: 2, y: 1 }],
      ],
      [
        { from: 's', to: 'a', kind: 'dep' },
        { from: 's', to: 'b', kind: 'conflict' },
      ],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    const exitLanes = routes.map((route) => route.segments[0]);
    expect(exitLanes[0]).toEqual({ axis: 'h', channel: 0, lane: 0 });
    expect(exitLanes[1]).toEqual({ axis: 'h', channel: 0, lane: 1 });
  });

  it('fan-in: entry stubs and shared gutter runs from different sources take distinct lanes; maxLanes reflects the busiest gutter channel', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 1, y: 1 }],
        ['c', { x: 1, y: 2 }],
        ['t', { x: 2, y: 1 }],
      ],
      [
        { from: 'a', to: 't', kind: 'dep' },
        { from: 'b', to: 't', kind: 'dep' },
        { from: 'c', to: 't', kind: 'dep' },
      ],
    );
    const { routes, maxLanes } = takeoverEdgeRoutes(graph);
    // Entry-side segments (last of each route) all live in corridor h:1 and spread lanes.
    const entry = routes.map((route) => route.segments[route.segments.length - 1]);
    expect(entry.every((s) => s.axis === 'h' && s.channel === 1)).toBe(true);
    expect(new Set(entry.map((s) => s.lane)).size).toBe(3);
    // The two Z routes share gutter v:1.5 with touching spans — distinct lanes.
    const gutter = allSpans(routes).filter((s) => s.axis === 'v' && s.channel === 1.5);
    expect(gutter).toHaveLength(2);
    expect(gutter[0].lane).not.toBe(gutter[1].lane);
    // The 3-lane entry corridor never counts: the busiest gutter channel (v:1.5) wins.
    expect(maxLanes).toBe(2);
  });

  it('same-column adjacent conflict runs straight between bottom and top borders', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 1, y: 1 }],
      ],
      [{ from: 'a', to: 'b', kind: 'conflict' }],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    expect(routes[0].points).toEqual([
      { x: 1, y: HALF },
      { x: 1, y: 1 - HALF },
    ]);
    expect(routes[0].segments).toEqual([{ axis: 'v', channel: 1, lane: 0 }]);
  });

  it('same-column far conflict detours through the right-hand gutters, oriented from → to', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 1, y: 2 }],
      ],
      [{ from: 'b', to: 'a', kind: 'conflict' }],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    expect(routes[0].points).toEqual([
      { x: 1, y: 2 - HALF },
      { x: 1, y: 1.5 },
      { x: 1.5, y: 1.5 },
      { x: 1.5, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 1, y: HALF },
    ]);
    expect(routes[0].segments.map((s) => `${s.axis}:${s.channel}`)).toEqual([
      'v:1',
      'h:1.5',
      'v:1.5',
      'h:0.5',
      'v:1',
    ]);
  });

  it('right-to-left conflicts route mirrored, preserving from → to point order', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 2, y: 0 }],
      ],
      [{ from: 'b', to: 'a', kind: 'conflict' }],
    );
    const { routes } = takeoverEdgeRoutes(graph);
    expect(routes[0].points).toEqual([
      { x: 2 - HALF, y: 0 },
      { x: 1 + HALF, y: 0 },
    ]);
  });

  it('drops dangling, self, and degenerate same-cell edges (takeoverMapEdges parity)', () => {
    const graph = g(
      [
        ['a', { x: 1, y: 0 }],
        ['b', { x: 1, y: 0 }],
        ['c', { x: 2, y: 0 }],
      ],
      [
        { from: 'a', to: 'ghost', kind: 'dep' },
        { from: 'ghost', to: 'a', kind: 'dep' },
        { from: 'a', to: 'a', kind: 'conflict' },
        { from: 'a', to: 'b', kind: 'conflict' },
        { from: 'a', to: 'c', kind: 'dep' },
      ],
    );
    const { routes, maxLanes } = takeoverEdgeRoutes(graph);
    expect(routes.map((route) => route.id)).toEqual(['a\u0000c\u0000dep']);
    expect(maxLanes).toBe(0);
  });

  it('routes islands and the virtual spec root at (0,0)', () => {
    const { routes } = takeoverEdgeRoutes(
      dependencyGraphLayout([t('a'), t('e', ['ghost']), t('f', ['e'])]),
    );
    expect(routes.map((route) => `${route.from}→${route.to}`)).toEqual(['spec→a', 'e→f']);
    // e sits at (1,2), f at (2,2): straight border-to-border run on row 2.
    expect(routes[1].points).toEqual([
      { x: 1 + HALF, y: 2 },
      { x: 2 - HALF, y: 2 },
    ]);
  });

  const busy = [
    t('a'),
    t('b'),
    t('c', ['a']),
    t('d', ['a', 'b']),
    t('e', ['b']),
    t('f', ['c', 'd'], ['e']),
    t('g', ['d', 'e']),
    t('h', ['f', 'g'], ['a']),
    t('i', ['ghost']),
    t('j', ['i']),
    t('k', ['i'], ['j']),
  ];

  it('busy fixture: routes are orthogonal and no two edges of different bundles share a collinear span', () => {
    const layout = dependencyGraphLayout(busy);
    const { routes, maxLanes } = takeoverEdgeRoutes(layout);
    expect(routes).toHaveLength(layout.edges.length);
    for (const route of routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(route.segments).toHaveLength(route.points.length - 1);
      route.segments.forEach((seg, i) => {
        const p = route.points[i];
        const q = route.points[i + 1];
        if (seg.axis === 'h') {
          expect(p.y).toBe(q.y);
          expect(p.x).not.toBe(q.x);
          expect(seg.channel).toBe(p.y);
        } else {
          expect(p.x).toBe(q.x);
          expect(p.y).not.toBe(q.y);
          expect(seg.channel).toBe(p.x);
        }
      });
    }
    const spans = allSpans(routes);
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const s = spans[i];
        const u = spans[j];
        if (s.axis !== u.axis || s.channel !== u.channel || s.lane !== u.lane) continue;
        // Same bundle (kind + from) may share a lane over overlapping spans.
        if (s.kind === u.kind && s.from === u.from) continue;
        // Same channel + lane across bundles: spans may not overlap or even touch.
        expect(s.lo > u.hi || u.lo > s.hi).toBe(true);
      }
    }
    // maxLanes bounds the gutter (half-integer) channels; corridor lanes are exempt.
    expect(maxLanes).toBeGreaterThanOrEqual(1);
    expect(spans.filter((s) => s.channel % 1 !== 0).every((s) => s.lane < maxLanes)).toBe(true);
  });

  it('is deterministic: same input yields identical routes and stats', () => {
    const one = takeoverEdgeRoutes(dependencyGraphLayout(busy));
    const two = takeoverEdgeRoutes(dependencyGraphLayout(busy.map((task) => ({ ...task }))));
    expect(two).toEqual(one);
  });

  it('counts only gutter channels in maxLanes, so corridor-only maps keep the gutter floor', () => {
    // A straight neighbor link occupies one corridor lane but no gutter.
    const straight = takeoverEdgeRoutes(
      g(
        [
          ['a', { x: 1, y: 0 }],
          ['t', { x: 2, y: 0 }],
        ],
        [{ from: 'a', to: 't', kind: 'dep' }],
      ),
    );
    expect(straight.maxLanes).toBe(0);
    // dep + conflict between the same cells spread onto two corridor lanes —
    // still no gutter demand, so the gutter width stays at the 12px floor.
    const corridorSpread = takeoverEdgeRoutes(
      g(
        [
          ['a', { x: 1, y: 0 }],
          ['b', { x: 2, y: 0 }],
        ],
        [
          { from: 'a', to: 'b', kind: 'dep' },
          { from: 'a', to: 'b', kind: 'conflict' },
        ],
      ),
    );
    expect(new Set(allSpans(corridorSpread.routes).map((s) => s.lane)).size).toBe(2);
    expect(corridorSpread.maxLanes).toBe(0);
    expect(takeoverGutterPx(corridorSpread.maxLanes)).toBe(HUD_TAKEOVER_GUTTER_MIN_PX);
    // Edge-free map: no lanes at all, same floor.
    expect(takeoverEdgeRoutes(g([], [])).maxLanes).toBe(0);
    expect(takeoverGutterPx(0)).toBe(HUD_TAKEOVER_GUTTER_MIN_PX);
  });
});

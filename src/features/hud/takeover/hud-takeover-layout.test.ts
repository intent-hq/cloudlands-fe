import { describe, expect, it } from 'vitest';
import {
  bannerDelay,
  bannerOutDelay,
  bannerScrollDurationS,
  canvasBounds,
  cellLeft,
  cellNeedsPan,
  cellTop,
  clampTakeoverPan,
  clampZoom,
  dependencyGraphLayout,
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
  takeoverGutterPx,
  takeoverPanBounds,
  takeoverPitchPx,
  type HudTakeoverGraphLayout,
} from './hud-takeover-layout';
import {
  HUD_TAKEOVER_EDGE_PALETTE,
  takeoverEdgeBoxPx,
  takeoverEdgeColorIndex,
  takeoverEdgePathD,
  takeoverEdgePulse,
  takeoverEdgeTouchesTask,
  takeoverMapEdges,
  type HudTakeoverEdgeTask,
} from './hud-takeover-edges';
import { takeoverEdgeRoutes } from './hud-takeover-routing';
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
      const tasks = [
        t('a'),
        t('b', ['a']),
        t('c', ['a']),
        t('d', ['b', 'c'], ['e']),
        t('e', ['ghost']),
      ];
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
      const { coords } = dependencyGraphLayout([
        t('a'),
        t('b', ['a']),
        t('c', ['a']),
        t('d', ['b', 'c']),
      ]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('b')!.x).toBe(2);
      expect(coords.get('c')!.x).toBe(2);
      expect(coords.get('b')!.y).not.toBe(coords.get('c')!.y);
      expect(coords.get('d')!.x).toBe(3);
    });

    it('longest path wins over the shortest dep edge', () => {
      const { coords } = dependencyGraphLayout([
        t('a'),
        t('b', ['a']),
        t('c', ['b']),
        t('d', ['a', 'c']),
      ]);
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

    it('keeps sparse columns: a lone dependent follows its parent row instead of snapping to 0', () => {
      // Roots a/b/c pack around the spec row; the d→e chain hangs off c and
      // stays on c's row 1 even though columns 2 and 3 hold a single card.
      const { coords } = dependencyGraphLayout([
        t('a'),
        t('b'),
        t('c'),
        t('d', ['c']),
        t('e', ['d']),
      ]);
      expect(coords.get('a')).toEqual({ x: 1, y: -1 });
      expect(coords.get('b')).toEqual({ x: 1, y: 0 });
      expect(coords.get('c')).toEqual({ x: 1, y: 1 });
      expect(coords.get('d')).toEqual({ x: 2, y: 1 });
      expect(coords.get('e')).toEqual({ x: 3, y: 1 });
    });

    it('nudges same-desired-row collisions apart deterministically without inverting the order', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b'), t('c', ['b']), t('d', ['b'])]);
      expect(coords.get('a')).toEqual({ x: 1, y: -1 });
      expect(coords.get('b')).toEqual({ x: 1, y: 0 });
      // c and d both want b's row 0: the minimal nudge spreads them around it,
      // keeping the input-order tie-break top→down.
      expect(coords.get('c')).toEqual({ x: 2, y: -1 });
      expect(coords.get('d')).toEqual({ x: 2, y: 0 });
    });

    it('islands stack below the full spec-component extent, not just row 0', () => {
      const { coords } = dependencyGraphLayout([t('a'), t('b'), t('c'), t('e', ['ghost'])]);
      // Spec component spans rows −1…1, so the island top lands at 1 + 2.
      expect(coords.get('c')).toEqual({ x: 1, y: 1 });
      expect(coords.get('e')).toEqual({ x: 1, y: 3 });
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
      const { coords } = dependencyGraphLayout([
        t('a'),
        t('b', ['a']),
        t('c', ['b']),
        t('d', ['c']),
      ]);
      const list = [...coords.values()];
      expect(canvasBounds(list)).toEqual({ minX: -2, maxX: 5, minY: -1, maxY: 1 });
      expect(takeoverPanBounds(list).maxX).toBe(5 * HUD_TAKEOVER_PITCH_PX);
      const empties = new Set(emptyCellCoords(list).map(({ x, y }) => `${x},${y}`));
      expect(empties.has('0,0')).toBe(false);
      expect(empties.has('1,0')).toBe(false);
      expect(empties.has('1,1')).toBe(true);
    });
  });

  describe('dependencyGraphLayout (spec-aware: specLinked on the wire)', () => {
    const s = (
      id: string,
      specLinked: boolean,
      dependsOn?: string[],
      conflictsWith?: string[],
    ) => ({ id, specLinked, dependsOn, conflictsWith });

    it('mixed linked/unlinked: spec edges only for linked dep-free tasks, unlinked islands at x=0', () => {
      const { coords, edges } = dependencyGraphLayout([
        s('a', true),
        s('b', true, ['a']),
        s('u', false),
      ]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('b')).toEqual({ x: 2, y: 0 });
      // u is an island root aligned with the spec column, below the spec component.
      expect(coords.get('u')).toEqual({ x: 0, y: 2 });
      expect(edges).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
        { from: 'a', to: 'b', kind: 'dep' },
      ]);
    });

    it('unlinked dep chains stay connected by dep edges but never gain a spec edge', () => {
      const { coords, edges } = dependencyGraphLayout([
        s('a', true),
        s('u', false),
        s('v', false, ['u']),
      ]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('u')).toEqual({ x: 0, y: 2 });
      expect(coords.get('v')).toEqual({ x: 1, y: 2 });
      expect(edges).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
        { from: 'u', to: 'v', kind: 'dep' },
      ]);
    });

    it('a linked task with deps joins the spec component via deps, not a spec edge', () => {
      const { edges } = dependencyGraphLayout([s('a', true), s('b', true, ['a'])]);
      expect(edges.filter((e) => e.kind === 'spec')).toEqual([
        { from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' },
      ]);
    });

    it('all-unlinked (daemon fallback): zero spec edges, every component is an island', () => {
      const { coords, edges } = dependencyGraphLayout([
        s('u', false),
        s('v', false, ['u']),
        s('w', false),
      ]);
      expect(edges.filter((e) => e.kind === 'spec')).toEqual([]);
      // Islands stack below the (empty) spec extent with the one-cell gutter.
      expect(coords.get('u')).toEqual({ x: 0, y: 2 });
      expect(coords.get('v')).toEqual({ x: 1, y: 2 });
      expect(coords.get('w')).toEqual({ x: 0, y: 4 });
    });

    it('subtask islands: an unlinked chain roots in the spec column and grows rightward', () => {
      const { coords } = dependencyGraphLayout([
        s('parent', true),
        s('sub1', false),
        s('sub2', false, ['sub1']),
        s('sub3', false, ['sub2']),
      ]);
      expect(coords.get('parent')).toEqual({ x: 1, y: 0 });
      expect(coords.get('sub1')).toEqual({ x: 0, y: 2 });
      expect(coords.get('sub2')).toEqual({ x: 1, y: 2 });
      expect(coords.get('sub3')).toEqual({ x: 2, y: 2 });
    });

    it('islands never occupy the spec origin and never overlap', () => {
      const tasks = [
        s('a', true),
        s('b', true, ['a']),
        s('u', false),
        s('v', false, ['u']),
        s('w', false),
        s('x', false, ['ghost']),
      ];
      const { coords } = dependencyGraphLayout(tasks);
      const keys = [...coords.values()].map(({ x, y }) => `${x},${y}`);
      expect(new Set(keys).size).toBe(tasks.length);
      expect(keys).not.toContain('0,0');
      for (const { x, y } of coords.values()) {
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
      }
    });

    it('legacy rows without the field keep dep-free spec rooting at x=1 (absent ≠ false)', () => {
      const { coords, edges } = dependencyGraphLayout([
        { id: 'a' },
        { id: 'e', dependsOn: ['ghost'] },
      ]);
      expect(coords.get('a')).toEqual({ x: 1, y: 0 });
      expect(coords.get('e')).toEqual({ x: 1, y: 2 });
      expect(edges).toEqual([{ from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a', kind: 'spec' }]);
    });

    it('is deterministic in spec-aware mode: same input yields the same coords and edges', () => {
      const tasks = [s('a', true), s('b', true, ['a']), s('u', false), s('v', false, ['u'])];
      const one = dependencyGraphLayout(tasks);
      const two = dependencyGraphLayout(tasks.map((task) => ({ ...task })));
      expect([...one.coords.entries()]).toEqual([...two.coords.entries()]);
      expect(one.edges).toEqual(two.edges);
    });
  });

  describe('takeoverGutterPx / takeoverPitchPx (dynamic gutter width)', () => {
    it('keeps the mock 12px gutter / 192px pitch when no channel carries lanes', () => {
      expect(takeoverGutterPx(0)).toBe(HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX);
      expect(takeoverPitchPx(0)).toBe(HUD_TAKEOVER_PITCH_PX);
    });

    it('grows with the busiest channel: lanes·8px + a 4px margin each side', () => {
      expect(takeoverGutterPx(1)).toBe(16);
      expect(takeoverGutterPx(3)).toBe(32);
      expect(takeoverGutterPx(12)).toBe(104);
      expect(takeoverPitchPx(12)).toBe(HUD_TAKEOVER_CELL_PX + 104);
    });

    it('the pitch feeds the px helpers: cells, pan bounds and fit scale widen with it', () => {
      const pitch = takeoverPitchPx(2); // 204
      expect(cellLeft(1, pitch)).toBe(`${pitch - 90}px`);
      expect(cellTop(-1, pitch)).toBe(`${-pitch - 90}px`);
      expect(takeoverPanBounds([], pitch).maxX).toBe(2 * pitch);
      // x=4 at pitch 204: half-extent 4·204+90=906 vs 500 → ≈0.552.
      const viewport = { width: 1000, height: 600 };
      expect(fitScale([{ x: 4, y: 0 }], viewport, pitch)).toBeCloseTo(500 / 906, 3);
      expect(takeoverGraphFits([{ x: 4, y: 0 }], viewport, 0.552, pitch)).toBe(true);
      expect(takeoverGraphFits([{ x: 4, y: 0 }], viewport, 1, pitch)).toBe(false);
    });
  });

  describe('takeoverMapEdges (lattice routes → px polylines)', () => {
    const t = (id: string, dependsOn?: string[], conflictsWith?: string[]) => ({
      id,
      dependsOn,
      conflictsWith,
    });
    const infos = (tasks: Array<ReturnType<typeof t>>, statuses: Record<string, string> = {}) =>
      tasks.map((task) => ({ id: task.id, status: statuses[task.id] ?? 'not_started' }));
    const route = (tasks: Array<ReturnType<typeof t>>) => {
      const routing = takeoverEdgeRoutes(dependencyGraphLayout(tasks));
      return { routing, pitch: takeoverPitchPx(routing.maxLanes) };
    };

    it('converts a straight spec edge into a border-to-border 2-point line with the arrow gap', () => {
      const tasks = [t('a')];
      const { routing, pitch } = route(tasks);
      expect(pitch).toBe(192); // corridor-only lanes → gutter stays at the 12px floor
      const [edge] = takeoverMapEdges(routing, infos(tasks), pitch);
      expect(edge.kind).toBe('spec');
      expect(edge.points).toEqual([
        { x: 90, y: 0 },
        { x: pitch - 92, y: 0 },
      ]);
    });

    it('offsets collinear edges by lane, centered on the channel', () => {
      // dep + conflict from one source are separate bundles, so their exit
      // stubs spread lanes (a same-kind fan-out would share one trunk lane).
      const graph: HudTakeoverGraphLayout = {
        coords: new Map([
          ['s', { x: 1, y: 0 }],
          ['a', { x: 2, y: 0 }],
          ['b', { x: 2, y: 1 }],
        ]),
        edges: [
          { from: 's', to: 'a', kind: 'dep' },
          { from: 's', to: 'b', kind: 'conflict' },
        ],
      };
      const routing = takeoverEdgeRoutes(graph);
      const pitch = takeoverPitchPx(routing.maxLanes); // 1 gutter lane (v:1.5) → 196
      const [toA, toB] = takeoverMapEdges(routing, [], pitch);
      // Exit stubs share corridor h:0 and spread symmetrically: lanes 0/1 → ∓4px.
      expect(toA.points).toEqual([
        { x: pitch + 90, y: -4 },
        { x: 2 * pitch - 92, y: -4 },
      ]);
      // b's route bends through gutter v:1.5 then enters on corridor h:1.
      expect(toB.points).toEqual([
        { x: pitch + 90, y: 4 },
        { x: 1.5 * pitch, y: 4 },
        { x: 1.5 * pitch, y: pitch },
        { x: 2 * pitch - 92, y: pitch },
      ]);
    });

    it('colors dep edges by the source task, rotating past the 10-entry palette', () => {
      // Chain t0 → t1 → … → t11: dep edge i has source index i (input order).
      const tasks = Array.from({ length: 12 }, (_, i) =>
        t(`t${i}`, i === 0 ? undefined : [`t${i - 1}`]),
      );
      const { routing, pitch } = route(tasks);
      const edges = takeoverMapEdges(routing, infos(tasks), pitch);
      expect(edges.map((edge) => edge.kind)).toEqual(['spec', ...Array(11).fill('dep')]);
      // Spec root edge stays uncolored; sources 0..10 rotate mod 10.
      expect(edges.map((edge) => edge.colorIndex)).toEqual([null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    });

    it('a source task fans all its outgoing dep edges out in the same color', () => {
      const tasks = [t('root'), t('a', ['root']), t('b', ['root'])];
      const { routing, pitch } = route(tasks);
      const deps = takeoverMapEdges(routing, infos(tasks), pitch).filter((e) => e.kind === 'dep');
      expect(deps).toHaveLength(2);
      expect(deps.map((edge) => edge.colorIndex)).toEqual([0, 0]);
    });

    it('color assignment is stable across re-renders (same input ⇒ same output)', () => {
      const tasks = [t('a'), t('b', ['a']), t('c', ['a'], ['b'])];
      const { routing, pitch } = route(tasks);
      const statuses = { a: 'complete', b: 'in_progress' };
      const first = takeoverMapEdges(routing, infos(tasks, statuses), pitch);
      const second = takeoverMapEdges(routing, infos(tasks, statuses), pitch);
      expect(second).toEqual(first);
    });

    it('dims dep edges whose destination is underway/finished; conflict/spec never dim', () => {
      const consumed = ['in_progress', 'review_required', 'complete', 'cancelled'];
      const fresh = ['not_started', 'waiting', 'blocked', 'discussion_needed'];
      const deps = Object.fromEntries(
        [...consumed, ...fresh].map((status, i) => [`d${i}`, status]),
      );
      const tasks = [t('src'), ...Object.keys(deps).map((id) => t(id, ['src']))];
      const { routing, pitch } = route(tasks);
      const edges = takeoverMapEdges(routing, infos(tasks, deps), pitch);
      const dimmedTo = new Map(
        routing.routes.map((r, i) => [r.to, edges[i]] as const).filter(([, e]) => e.kind === 'dep'),
      );
      for (const [id, status] of Object.entries(deps)) {
        expect(dimmedTo.get(id)?.dimmed, `${id} (${status})`).toBe(consumed.includes(status));
      }

      // Conflict edges never take a palette color; a resolved conflict
      // (either endpoint complete or cancelled) dims to static muted.
      const conflicted = [t('a'), t('b', undefined, ['a'])];
      const { routing: cRouting, pitch: cPitch } = route(conflicted);
      const conflict = takeoverMapEdges(
        cRouting,
        infos(conflicted, { a: 'complete', b: 'in_progress' }),
        cPitch,
      ).find((edge) => edge.kind === 'conflict');
      expect(conflict).toMatchObject({ colorIndex: null, dimmed: true, pulse: null });
      // A cancelled endpoint resolves the conflict the same way.
      const cancelled = takeoverMapEdges(
        cRouting,
        infos(conflicted, { a: 'in_progress', b: 'cancelled' }),
        cPitch,
      ).find((edge) => edge.kind === 'conflict');
      expect(cancelled).toMatchObject({ colorIndex: null, dimmed: true, pulse: null });
      // A live conflict (neither complete nor cancelled) never dims — it
      // pulses instead.
      const live = takeoverMapEdges(
        cRouting,
        infos(conflicted, { a: 'in_progress', b: 'not_started' }),
        cPitch,
      ).find((edge) => edge.kind === 'conflict');
      expect(live).toMatchObject({ colorIndex: null, dimmed: false, pulse: 'conflict' });
      // Spec edges never dim, even into an in-progress task.
      const spec = takeoverMapEdges(cRouting, infos(conflicted, { a: 'in_progress' }), cPitch).find(
        (edge) => edge.kind === 'spec',
      );
      expect(spec).toMatchObject({ colorIndex: null, dimmed: false, pulse: null });
    });

    it('pulses green only the incoming dep edges of a ready task (deps met, not started)', () => {
      // c is ready: non-empty dependsOn, no unmetDependsOn, not_started.
      const tasks = [t('a'), t('b'), t('c', ['a', 'b'])];
      const { routing, pitch } = route(tasks);
      const edgeTasks: HudTakeoverEdgeTask[] = [
        { id: 'a', status: 'complete' },
        { id: 'b', status: 'complete' },
        { id: 'c', status: 'not_started', dependsOn: ['a', 'b'] },
      ];
      const edges = takeoverMapEdges(routing, edgeTasks, pitch);
      const pulseTo = new Map(routing.routes.map((r, i) => [`${r.kind}:${r.to}`, edges[i].pulse]));
      // Both incoming dep edges pulse; the spec edges into the dependency-free
      // roots a/b never pulse.
      expect(pulseTo.get('dep:c')).toBe('ready');
      expect(pulseTo.get('spec:a')).toBeNull();
      expect(pulseTo.get('spec:b')).toBeNull();
      expect(edges.filter((edge) => edge.pulse === 'ready')).toHaveLength(2);
      // Ready edges are full-strength (not_started is not a consumed status).
      for (const edge of edges) {
        if (edge.pulse === 'ready') expect(edge.dimmed).toBe(false);
      }

      // Unmet dependencies suppress the ready pulse even when not started.
      const unmet = takeoverMapEdges(
        routing,
        edgeTasks.map((task) =>
          task.id === 'c' ? { ...task, unmetDependsOn: ['a'] } : { ...task, status: 'in_progress' },
        ),
        pitch,
      );
      expect(unmet.every((edge) => edge.pulse !== 'ready')).toBe(true);
    });

    it('carries the route endpoint ids on every drawable edge (dep/spec/conflict)', () => {
      const tasks = [t('a'), t('b', ['a'], ['c']), t('c', ['b'])];
      const { routing, pitch } = route(tasks);
      const edges = takeoverMapEdges(routing, infos(tasks), pitch);
      expect(edges.map((edge) => ({ kind: edge.kind, from: edge.from, to: edge.to }))).toEqual(
        routing.routes.map((r) => ({ kind: r.kind, from: r.from, to: r.to })),
      );
      // The rootless task's spec edge anchors at the virtual spec node.
      const spec = edges.find((edge) => edge.kind === 'spec');
      expect(spec).toMatchObject({ from: HUD_TAKEOVER_SPEC_NODE_ID, to: 'a' });
    });

    it('busy fixture: px segments stay orthogonal and never cross a cell interior', () => {
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
      const layout = dependencyGraphLayout(busy);
      const routing = takeoverEdgeRoutes(layout);
      const pitch = takeoverPitchPx(routing.maxLanes);
      const edges = takeoverMapEdges(routing, infos(busy), pitch);
      expect(edges).toHaveLength(routing.routes.length);
      const cells = [{ x: 0, y: 0 }, ...layout.coords.values()];
      const half = HUD_TAKEOVER_CELL_PX / 2;
      /** True when the run's fixed coord sits strictly inside the cell band
       *  AND its travel span overlaps the cell's open interior. */
      const cutsCell = (fixed: number, lo: number, hi: number, cFixed: number, cTravel: number) =>
        fixed > cFixed - half &&
        fixed < cFixed + half &&
        Math.max(lo, cTravel - half) < Math.min(hi, cTravel + half);
      for (const edge of edges) {
        expect(edge.points.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < edge.points.length - 1; i++) {
          const p = edge.points[i];
          const q = edge.points[i + 1];
          expect(p.x === q.x || p.y === q.y).toBe(true);
          for (const cell of cells) {
            const cut =
              p.y === q.y
                ? cutsCell(
                    p.y,
                    Math.min(p.x, q.x),
                    Math.max(p.x, q.x),
                    cell.y * pitch,
                    cell.x * pitch,
                  )
                : cutsCell(
                    p.x,
                    Math.min(p.y, q.y),
                    Math.max(p.y, q.y),
                    cell.x * pitch,
                    cell.y * pitch,
                  );
            expect(cut).toBe(false);
          }
        }
      }
    });
  });

  describe('takeoverEdgePulse (pure edge → visual-state mapping)', () => {
    const task = (
      status: string,
      extra: Partial<HudTakeoverEdgeTask> = {},
    ): HudTakeoverEdgeTask => ({
      id: 'x',
      status,
      ...extra,
    });
    const STATUSES = [
      'not_started',
      'waiting',
      'discussion_needed',
      'blocked',
      'in_progress',
      'review_required',
      'complete',
      'cancelled',
    ];

    it('conflict edges pulse red while NEITHER endpoint is complete nor cancelled', () => {
      const resolved = ['complete', 'cancelled'];
      for (const a of STATUSES) {
        for (const b of STATUSES) {
          const expected = resolved.includes(a) || resolved.includes(b) ? null : 'conflict';
          expect(takeoverEdgePulse('conflict', task(a), task(b)), `${a} × ${b}`).toBe(expected);
        }
      }
      // Unknown endpoints are neither complete nor cancelled → still live.
      expect(takeoverEdgePulse('conflict', undefined, undefined)).toBe('conflict');
      expect(takeoverEdgePulse('conflict', task('complete'), undefined)).toBeNull();
      expect(takeoverEdgePulse('conflict', task('cancelled'), undefined)).toBeNull();
      expect(takeoverEdgePulse('conflict', undefined, task('cancelled'))).toBeNull();
    });

    it('dep edges pulse green ONLY into a ready task (deps met, not started)', () => {
      const ready = { dependsOn: ['d1'] };
      for (const status of STATUSES) {
        const expected = status === 'not_started' ? 'ready' : null;
        expect(takeoverEdgePulse('dep', task('complete'), task(status, ready)), status).toBe(
          expected,
        );
      }
      // Empty unmetDependsOn counts as met; non-empty suppresses the pulse.
      expect(
        takeoverEdgePulse('dep', undefined, task('not_started', { ...ready, unmetDependsOn: [] })),
      ).toBe('ready');
      expect(
        takeoverEdgePulse(
          'dep',
          undefined,
          task('not_started', { ...ready, unmetDependsOn: ['d1'] }),
        ),
      ).toBeNull();
      // Dependency-free destinations never pulse, nor do unknown ones.
      expect(takeoverEdgePulse('dep', undefined, task('not_started'))).toBeNull();
      expect(
        takeoverEdgePulse('dep', undefined, task('not_started', { dependsOn: [] })),
      ).toBeNull();
      expect(takeoverEdgePulse('dep', task('complete'), undefined)).toBeNull();
    });

    it('spec edges never pulse', () => {
      for (const status of STATUSES) {
        expect(
          takeoverEdgePulse('spec', undefined, task(status, { dependsOn: ['d1'] })),
          status,
        ).toBeNull();
      }
    });
  });

  describe('takeoverEdgeTouchesTask (hover-highlight edge matching)', () => {
    const edge = (from: string, to: string) => ({ from, to });

    it('matches incoming and outgoing edges of the hovered task', () => {
      expect(takeoverEdgeTouchesTask(edge('a', 'b'), 'a')).toBe(true);
      expect(takeoverEdgeTouchesTask(edge('a', 'b'), 'b')).toBe(true);
      expect(takeoverEdgeTouchesTask(edge('a', 'b'), 'c')).toBe(false);
    });

    it("matches the task's spec edge via its destination", () => {
      expect(takeoverEdgeTouchesTask(edge(HUD_TAKEOVER_SPEC_NODE_ID, 'a'), 'a')).toBe(true);
      expect(takeoverEdgeTouchesTask(edge(HUD_TAKEOVER_SPEC_NODE_ID, 'a'), 'b')).toBe(false);
    });

    it('a null hover matches nothing', () => {
      expect(takeoverEdgeTouchesTask(edge('a', 'b'), null)).toBe(false);
    });
  });

  describe('takeoverEdgePathD (polyline → path with rounded bends)', () => {
    it('renders a 2-point run as a plain M/L line', () => {
      expect(
        takeoverEdgePathD([
          { x: 90, y: 0 },
          { x: 104, y: -4 },
        ]),
      ).toBe('M90 0L104 -4');
    });

    it('rounds each interior bend with a quadratic corner', () => {
      expect(
        takeoverEdgePathD([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ]),
      ).toBe('M0 0L7.5 0Q10 0 10 2.5L10 10');
    });

    it('clamps the corner radius to half the shorter adjacent run', () => {
      expect(
        takeoverEdgePathD([
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 10 },
        ]),
      ).toBe('M0 0L1.5 0Q3 0 3 1.5L3 10');
    });
  });

  describe('takeoverEdgeColorIndex (palette assignment)', () => {
    it('rotates the 10-entry palette by input-order index', () => {
      expect(HUD_TAKEOVER_EDGE_PALETTE).toHaveLength(10);
      expect(takeoverEdgeColorIndex(0)).toBe(0);
      expect(takeoverEdgeColorIndex(9)).toBe(9);
      expect(takeoverEdgeColorIndex(10)).toBe(0);
      expect(takeoverEdgeColorIndex(23)).toBe(3);
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
        takeoverFrameFrom(
          { left: 0, top: 0, width: 0, height: 0 },
          { left: 0, top: 0, width: 10, height: 10 },
        ),
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

import { describe, expect, it } from 'vitest';
import {
  alignMermaidOpenArrowheads,
  buildDownstreamFanoutRoutes,
  buildRoundedOrthogonalPath,
  buildFlowchartDecisionBranchPoints,
  buildFlowchartDecisionReturnPoints,
  buildFlowchartFeedbackLanePoints,
  buildGroupedReturnLanePoints,
  chooseFlowchartFeedbackTargetX,
  chooseFlowchartFeedbackInsideX,
  chooseClearFlowchartRoute,
  chooseClearFlowchartLabel,
  chooseClearLocalReturn,
  chooseLabelSegment,
  chooseStateLabelPathIndex,
  chooseClearStateEntryRoute,
  diamondBoundaryPort,
  diamondRayIntersection,
  expandFlowchartFeedbackLane,
  findFlowchartDecisionCycle,
  measuredClusterHeaderHeight,
  preferClearStraightRoute,
  replacePathTerminal,
  routeOrthogonalAroundObstacles,
  roundOrthogonalBends,
  separateFlowchartVerticalLane,
  simplifyOrthogonalPoints,
  snapOrthogonalTerminals,
} from '../mermaid-path-geometry';

type TestPoint = { x: number; y: number };
type TestBounds = TestPoint & { width: number; height: number };

function expectOrthogonalRoute(points: TestPoint[]) {
  expect(
    points.slice(0, -1).every((point, index) => {
      const next = points[index + 1];
      return Math.abs(point.x - next.x) < 0.001 || Math.abs(point.y - next.y) < 0.001;
    }),
  ).toBe(true);
}

function segmentEntersBounds(start: TestPoint, end: TestPoint, bounds: TestBounds) {
  if (Math.abs(start.x - end.x) < 0.001) {
    return (
      start.x > bounds.x &&
      start.x < bounds.x + bounds.width &&
      Math.max(start.y, end.y) > bounds.y &&
      Math.min(start.y, end.y) < bounds.y + bounds.height
    );
  }
  if (Math.abs(start.y - end.y) >= 0.001) return true;
  return (
    start.y > bounds.y &&
    start.y < bounds.y + bounds.height &&
    Math.max(start.x, end.x) > bounds.x &&
    Math.min(start.x, end.x) < bounds.x + bounds.width
  );
}

function expectRouteAvoids(points: TestPoint[], bounds: TestBounds) {
  expect(
    points
      .slice(0, -1)
      .some((point, index) => segmentEntersBounds(point, points[index + 1], bounds)),
  ).toBe(false);
}

describe('Mermaid path terminal geometry', () => {
  describe('decision-cycle topology', () => {
    const edges = [
      { source: 'receive', target: 'gate' },
      { source: 'gate', target: 'hold' },
      { source: 'hold', target: 'gate' },
      { source: 'gate', target: 'apply' },
      { source: 'apply', target: 'finish' },
    ];

    it('identifies the continuation independently of edge order, names or labels', () => {
      expect(findFlowchartDecisionCycle([...edges].reverse(), ['gate'])).toEqual({
        decision: 'gate',
        retry: 'hold',
        spine: ['receive', 'gate', 'apply', 'finish'],
      });
      const rename = (id: string) => `unrelated_${id.length}_${id}`;
      expect(
        findFlowchartDecisionCycle(
          edges.map(({ source, target }) => ({
            source: rename(source),
            target: rename(target),
          })),
          [rename('gate')],
        )?.spine,
      ).toEqual(['receive', 'gate', 'apply', 'finish'].map(rename));
    });

    it('rejects a work branch which also joins the continuation', () => {
      expect(
        findFlowchartDecisionCycle([...edges, { source: 'hold', target: 'apply' }], ['gate']),
      ).toBeNull();
    });

    it('rejects ambiguous cycles and disconnected topology', () => {
      expect(
        findFlowchartDecisionCycle([...edges, { source: 'apply', target: 'gate' }], ['gate']),
      ).toBeNull();
      expect(
        findFlowchartDecisionCycle(
          [...edges, { source: 'elsewhere', target: 'elsewhere' }],
          ['gate'],
        ),
      ).toBeNull();
      expect(findFlowchartDecisionCycle(edges, ['gate', 'apply'])).toBeNull();
    });

    it('uses authored direction and rejects a missing return edge', () => {
      expect(
        findFlowchartDecisionCycle(
          edges.filter((edge) => edge.source !== 'hold'),
          ['gate'],
        ),
      ).toBeNull();
      expect(
        findFlowchartDecisionCycle(
          edges.map(({ source, target }) => ({ source: target, target: source })),
          ['gate'],
        ),
      ).toEqual({
        decision: 'gate',
        retry: 'hold',
        spine: ['finish', 'apply', 'gate', 'receive'],
      });
    });
  });

  describe('final outer feedback envelope', () => {
    const points = [
      { x: 40, y: 400 },
      { x: 80, y: 400 },
      { x: 80, y: 500 },
      { x: -70, y: 500 },
      { x: -70, y: -12 },
      { x: 0, y: -12 },
      { x: 0, y: 0 },
    ];

    it('expands past a later annotate corridor without moving ports or shelves', () => {
      const occupied = [{ x: -90, y: 150, width: 120, height: 150 }];
      const result = expandFlowchartFeedbackLane(points, occupied);
      expectOrthogonalRoute(result);
      expect(result[3].x).toBeLessThanOrEqual(occupied[0].x - 20);
      expect(result[4].x).toBe(result[3].x);
      for (const index of [0, 1, 2, 5, 6]) expect(result[index]).toEqual(points[index]);
      expectRouteAvoids(result, occupied[0]);
      expect(expandFlowchartFeedbackLane(result, occupied)).toBe(result);
    });

    it('includes protruding labels but ignores vertically disjoint corridors', () => {
      const result = expandFlowchartFeedbackLane(points, [
        { x: -95, y: 200, width: 30, height: 20 },
        { x: -200, y: 550, width: 60, height: 100 },
      ]);
      expect(result[3].x).toBe(-115);
      expectOrthogonalRoute(result);
    });

    it('leaves a sufficiently external lane and other route shapes unchanged', () => {
      expect(
        expandFlowchartFeedbackLane(points, [{ x: -40, y: 100, width: 80, height: 100 }]),
      ).toBe(points);
      const local = points.slice(0, 4);
      expect(
        expandFlowchartFeedbackLane(local, [{ x: -100, y: 100, width: 80, height: 100 }]),
      ).toBe(local);
    });
  });

  describe('adjacent feedback lane clearance', () => {
    const points = [
      { x: 20, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 160 },
      { x: 20, y: 160 },
    ];
    const feedback = [{ start: { x: 108, y: 20 }, end: { x: 108, y: 180 } }];

    it('moves only the adjacent run, retaining endpoints and repeat-fit stability', () => {
      const result = separateFlowchartVerticalLane(points, feedback, []);
      expectOrthogonalRoute(result);
      expect(result[0]).toEqual(points[0]);
      expect(result.at(-1)).toEqual(points.at(-1));
      expect(result[1].x).toBe(88);
      expect(result[2].x).toBe(88);
      expect(separateFlowchartVerticalLane(result, feedback, [])).toBe(result);
    });

    it('retains the safe route when occupied paint blocks the separated lane', () => {
      const obstacle = { x: 82, y: 70, width: 12, height: 30 };
      expect(separateFlowchartVerticalLane(points, feedback, [obstacle])).toBe(points);
    });

    it('does not move sufficiently separated or vertically disjoint runs', () => {
      for (const occupied of [
        [{ start: { x: 130, y: 20 }, end: { x: 130, y: 180 } }],
        [{ start: { x: 108, y: 200 }, end: { x: 108, y: 300 } }],
      ])
        expect(separateFlowchartVerticalLane(points, occupied, [])).toBe(points);
    });

    it('does not split coincident shared trunks', () => {
      const shared = [{ start: { x: 100, y: 20 }, end: { x: 100, y: 180 } }];
      expect(separateFlowchartVerticalLane(points, shared, [])).toBe(points);
    });
  });

  describe('local reciprocal return', () => {
    const exterior = [
      { x: 160, y: 140 },
      { x: 160, y: 240 },
      { x: 20, y: 240 },
      { x: 20, y: 40 },
    ];
    const local = [
      { x: 160, y: 100 },
      { x: 160, y: 60 },
      { x: 20, y: 60 },
      { x: 20, y: 40 },
    ];
    const label = { bounds: { x: 70, y: 224, width: 40, height: 32 }, obstacles: [] };
    it('chooses a shorter clear return with room for its own label', () => {
      const result = chooseClearLocalReturn(exterior, [local], [], [], label);
      expectOrthogonalRoute(result);
      expect(result).toEqual(local);
      expect(chooseClearFlowchartLabel(result, label.bounds, [], [])).toBeDefined();
      expect(chooseClearLocalReturn(result, [local], [], [], label)).toBe(result);
    });
    it.each(['node', 'heading'])(
      'retains the exterior lane when a %s blocks the local corridor',
      () => {
        const obstacle = { x: 65, y: 45, width: 40, height: 30 };
        expect(chooseClearLocalReturn(exterior, [local], [obstacle], [], label)).toBe(exterior);
      },
    );
    it('rejects both crossing and nearby parallel occupied routes', () => {
      for (const occupied of [
        { start: { x: 90, y: 20 }, end: { x: 90, y: 90 } },
        { start: { x: 40, y: 65 }, end: { x: 140, y: 65 } },
      ])
        expect(chooseClearLocalReturn(exterior, [local], [], [occupied], label)).toBe(exterior);
    });
    it('retains the return if the label cannot fit even though the centerline clears', () => {
      expect(
        chooseClearLocalReturn(exterior, [local], [], [], {
          ...label,
          obstacles: [{ x: 0, y: 20, width: 200, height: 100 }],
        }),
      ).toBe(exterior);
    });
    it('does not replace the original with a longer or more-bent route', () => {
      expect(chooseClearLocalReturn(local, [exterior], [], [], label)).toBe(local);
      expect(
        chooseClearLocalReturn(
          exterior,
          [[...local.slice(0, 2), { x: 90, y: 60 }, { x: 90, y: 50 }, { x: 20, y: 50 }, local[3]]],
          [],
          [],
          label,
        ),
      ).toBe(exterior);
    });
  });

  describe('measured route-label clearance', () => {
    it('moves a label along its own route away from an unrelated crossing', () => {
      const route = [
        { x: 0, y: 0 },
        { x: 0, y: 160 },
      ];
      const current = { x: -30, y: 70, width: 60, height: 20 };
      const crossing = { start: { x: -50, y: 80 }, end: { x: 50, y: 80 } };
      const result = chooseClearFlowchartLabel(route, current, [], [crossing]);
      expect(result).toBeDefined();
      expect(result!.center.x).toBe(0);
      expect(segmentEntersBounds(crossing.start, crossing.end, result!.bounds)).toBe(false);
      expect(result!.bounds.width).toBe(60);
      expect(result!.bounds.height).toBe(20);
      expect(chooseClearFlowchartLabel(route, result!.bounds, [], [crossing])!.bounds).toEqual(
        result!.bounds,
      );
    });
    it('does not hide a crossing or a node when no readable label corridor exists', () => {
      const route = [
        { x: 0, y: 0 },
        { x: 0, y: 30 },
      ];
      const label = { x: -30, y: 5, width: 60, height: 20 };
      expect(chooseClearFlowchartLabel(route, label, [], [])).toBeUndefined();
      expect(
        chooseClearFlowchartLabel(
          [
            { x: 0, y: 0 },
            { x: 0, y: 160 },
          ],
          label,
          [{ x: -100, y: -100, width: 200, height: 400 }],
          [],
        ),
      ).toBeUndefined();
    });
  });

  describe('local obstacle repair', () => {
    const source = { x: 0, y: 0, width: 80, height: 40 };
    const target = { x: 200, y: 180, width: 100, height: 40 };
    const blocked = [
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 250, y: 100 },
      { x: 250, y: 180 },
    ];
    it('keeps repaired attachments on straight sides of rounded nodes', () => {
      const roundedSource = { ...source, corner: { x: 18, y: 18 } };
      const roundedTarget = { ...target, corner: { x: 18, y: 18 } };
      const result = chooseClearFlowchartRoute(
        blocked,
        roundedSource,
        roundedTarget,
        [{ x: 0, y: 80, width: 100, height: 40 }],
        [],
      );
      expect(result).not.toBe(blocked);
      for (const [point, bounds] of [
        [result[0], roundedSource],
        [result.at(-1)!, roundedTarget],
      ] as const) {
        if (point.x === bounds.x || point.x === bounds.x + bounds.width) {
          expect(point.y - bounds.y).toBeGreaterThanOrEqual(18);
          expect(bounds.y + bounds.height - point.y).toBeGreaterThanOrEqual(18);
        } else {
          expect(point.x - bounds.x).toBeGreaterThanOrEqual(18);
          expect(bounds.x + bounds.width - point.x).toBeGreaterThanOrEqual(18);
        }
      }
    });
    it('avoids an intervening node and a competing target approach without moving nodes', () => {
      const obstacle = { x: 0, y: 80, width: 100, height: 40 };
      const occupied = [
        { start: { x: 50, y: 160 }, end: { x: 258, y: 160 } },
        { start: { x: 258, y: 160 }, end: { x: 258, y: 180 } },
      ];
      const result = chooseClearFlowchartRoute(
        blocked,
        source,
        target,
        [obstacle],
        occupied,
        [],
        [{ x: 258, y: 180 }],
      );
      expect(result).not.toBe(blocked);
      expectOrthogonalRoute(result);
      [source, target, obstacle].forEach((bounds) => expectRouteAvoids(result, bounds));
      for (const segment of occupied)
        expectRouteAvoids(result, {
          x: Math.min(segment.start.x, segment.end.x) - 1,
          y: Math.min(segment.start.y, segment.end.y) - 1,
          width: Math.abs(segment.end.x - segment.start.x) + 2,
          height: Math.abs(segment.end.y - segment.start.y) + 2,
        });
      const again = chooseClearFlowchartRoute(result, source, target, [obstacle], occupied);
      expect(again).toBe(result);
    });
    it('keeps a clear straight corridor and its exact ports unchanged', () => {
      const route = [
        { x: 80, y: 20 },
        { x: 200, y: 20 },
      ];
      expect(chooseClearFlowchartRoute(route, source, { ...target, y: 0 }, [], [])).toBe(route);
    });
    it('repairs a blocked branch without changing its assigned fan-out source port', () => {
      const obstacle = { x: 0, y: 80, width: 100, height: 40 };
      const result = chooseClearFlowchartRoute(
        blocked,
        source,
        target,
        [obstacle],
        [],
        [],
        [],
        undefined,
        true,
      );
      expect(result).not.toBe(blocked);
      expect(result[0]).toEqual(blocked[0]);
      expect(result[1].x).toBe(blocked[0].x);
      expect(result[1].y).toBeGreaterThan(blocked[0].y);
      expectOrthogonalRoute(result);
      [source, target, obstacle].forEach((bounds) => expectRouteAvoids(result, bounds));
    });
    it('leaves an impossible corridor intact instead of accepting a node collision', () => {
      expect(
        chooseClearFlowchartRoute(
          blocked,
          source,
          target,
          [{ x: -20, y: -20, width: 400, height: 300 }],
          [],
        ),
      ).toBe(blocked);
      expect(chooseClearFlowchartRoute([], source, target, [], [])).toEqual([]);
    });
  });

  describe('shorter local detours', () => {
    const source = { x: 100, y: 100, width: 80, height: 40 };
    const target = { x: 100, y: 300, width: 80, height: 40 };
    const outer = [
      { x: 140, y: 100 },
      { x: 140, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 320 },
      { x: 100, y: 320 },
    ];
    it('shortens without an above-source excursion or occupied-route crossing', () => {
      const occupied = [{ start: { x: 60, y: 160 }, end: { x: 60, y: 290 } }];
      const result = chooseClearFlowchartRoute(
        outer,
        source,
        target,
        [],
        occupied,
        [],
        [],
        undefined,
        false,
        true,
      );
      expect(result).not.toBe(outer);
      expectOrthogonalRoute(result);
      expect(result.every((p) => p.y >= source.y)).toBe(true);
      expectRouteAvoids(result, { x: 59, y: 160, width: 2, height: 130 });
      expectRouteAvoids(result, source);
      expectRouteAvoids(result, target);
    });
    it('keeps the exterior fallback when every local corridor is obstructed', () => {
      const walls = [
        { x: 20, y: 80, width: 60, height: 220 },
        { x: 190, y: 80, width: 60, height: 220 },
        { x: 20, y: 150, width: 230, height: 100 },
      ];
      walls.forEach((wall) => expectRouteAvoids(outer, wall));
      expect(
        chooseClearFlowchartRoute(outer, source, target, walls, [], [], [], undefined, false, true),
      ).toBe(outer);
    });
  });

  describe('downstream fanout corridors', () => {
    const source = { x: 110, y: 70, width: 100, height: 50 };
    const targets = [
      { bounds: { x: 300, y: 210, width: 100, height: 50 }, port: { x: 350, y: 210 } },
      { bounds: { x: 200, y: 430, width: 100, height: 50 }, port: { x: 242, y: 430 } },
    ];

    it.each([1, 1.7])(
      'uses a common right exit and top entries under scale %s and translation',
      (scale) => {
        const point = ({ x, y }: TestPoint) => ({ x: x * scale - 87, y: y * scale + 43 });
        const bounds = (b: TestBounds) => ({
          ...point(b),
          width: b.width * scale,
          height: b.height * scale,
        });
        const s = bounds(source);
        const t = targets.map((target) => ({
          bounds: bounds(target.bounds),
          port: point(target.port),
        }));
        const routes = buildDownstreamFanoutRoutes(s, t, [], []);
        expect(routes).not.toBeNull();
        for (const [index, route] of routes!.entries()) {
          expectOrthogonalRoute(route);
          expect(route[0]).toEqual({ x: s.x + s.width, y: s.y + s.height / 2 });
          expect(route.at(-1)).toEqual(t[index].port);
          expect(route.at(-2)!.x).toBe(t[index].port.x);
          expect(route.at(-2)!.y).toBeLessThan(t[index].bounds.y);
          t.forEach((target) => expectRouteAvoids(route, target.bounds));
        }
        expect(routes![0].slice(0, 2)).toEqual(routes![1].slice(0, 2));
      },
    );

    it('keeps a valid downstream terminal leg rather than replacing it', () => {
      const tail = [{ x: 350, y: 174 }, targets[0].port];
      const routes = buildDownstreamFanoutRoutes(
        source,
        [{ ...targets[0], tail }, targets[1]],
        [],
        [],
      );
      expect(routes![0].slice(-2)).toEqual(tail);
    });

    it('enters an overlapping target from outside its left edge, not through its interior', () => {
      const overlapping = { ...targets[1], port: { x: targets[1].bounds.x, y: 455 } };
      const routes = buildDownstreamFanoutRoutes(source, [targets[0], overlapping], [], []);
      expect(routes).not.toBeNull();
      expect(routes![1].at(-2)!.x).toBeLessThan(overlapping.bounds.x);
      expect(routes![1].at(-1)).toEqual(overlapping.port);
      expectRouteAvoids(routes![1], overlapping.bounds);
      expectRouteAvoids(routes![0], overlapping.bounds);
      expect(routes![0].slice(0, 2)).toEqual(routes![1].slice(0, 2));
    });

    it.each(['node', 'label', 'unrelated route'])(
      'leaves the whole group unchanged for a blocked %s corridor',
      (kind) => {
        const block = { x: 215, y: 140, width: 24, height: 24 };
        expect(
          buildDownstreamFanoutRoutes(
            source,
            targets,
            kind === 'unrelated route' ? [] : [block],
            kind === 'unrelated route' ? [block] : [],
          ),
        ).toBeNull();
      },
    );

    it('rejects an old terminal leg through a sibling and chooses a clear top approach', () => {
      const blocked = {
        bounds: { x: 310, y: 340, width: 100, height: 50 },
        port: { x: 350, y: 340 },
        tail: [
          { x: 350, y: 180 },
          { x: 350, y: 340 },
        ],
      };
      const routes = buildDownstreamFanoutRoutes(source, [targets[0], blocked], [], []);
      expect(routes).not.toBeNull();
      expect(routes![1].slice(-2)).not.toEqual(blocked.tail);
      routes!.forEach((route) => expectRouteAvoids(route, targets[0].bounds));
    });

    it('does not repurpose compact, upstream, or three-arm groups', () => {
      expect(
        buildDownstreamFanoutRoutes(
          source,
          [targets[0], { ...targets[1], port: { x: 150, y: 430 } }],
          [],
          [],
        ),
      ).toBeNull();
      expect(
        buildDownstreamFanoutRoutes(
          source,
          targets.map((target) => ({ ...target, bounds: { ...target.bounds, y: 100 } })),
          [],
          [],
        ),
      ).toBeNull();
      expect(buildDownstreamFanoutRoutes(source, [...targets, targets[0]], [], [])).toBeNull();
    });
  });

  describe('state label route association', () => {
    const paths = Array.from({ length: 6 }, (_, index) => ({
      id: `render-edge-${index}`,
      nativeId: `edge${index}`,
      intersectsLabel: false,
    }));

    it('uses native identities when unlabeled terminal edges outnumber labels', () => {
      const labels = ['edge1', 'edge2', 'edge3', 'edge4'];

      expect(labels.map((nativeId) => chooseStateLabelPathIndex({ nativeId }, paths))).toEqual([
        1, 2, 3, 4,
      ]);
    });

    it('falls back only to one painted label intersection', () => {
      const candidates = paths.map((path, index) => ({
        ...path,
        intersectsLabel: index === 2,
      }));

      expect(chooseStateLabelPathIndex({}, candidates)).toBe(2);
      expect(
        chooseStateLabelPathIndex(
          {},
          candidates.map((path, index) => ({
            ...path,
            intersectsLabel: index === 2 || index === 3,
          })),
        ),
      ).toBeNull();
      expect(
        chooseStateLabelPathIndex(
          {},
          candidates.map((path) => ({ ...path, intersectsLabel: false })),
        ),
      ).toBeNull();
    });

    it('rejects ambiguous native and cached identities without falling through', () => {
      expect(
        chooseStateLabelPathIndex(
          { nativeId: 'edge2' },
          paths.map((path, index) => ({
            ...path,
            nativeId: index === 3 ? 'edge2' : path.nativeId,
            intersectsLabel: index === 2,
          })),
        ),
      ).toBeNull();
      expect(
        chooseStateLabelPathIndex({ routePathId: 'render-edge-2' }, [
          ...paths,
          { ...paths[2], intersectsLabel: true },
        ]),
      ).toBeNull();
    });
  });

  describe('clear straight boundary ports', () => {
    const diamond = { x: 0, y: 0, width: 100, height: 100 };
    const source = { point: diamondBoundaryPort(diamond, 'right', 8), side: 'right' as const };
    const target = {
      point: { x: 280, y: 60 },
      side: 'left' as const,
      range: [38, 72] as [number, number],
    };
    const jog = [source.point, { x: 150, y: 58 }, { x: 150, y: 60 }, target.point];

    it('slides a free rectangular target onto the assigned diamond port corridor', () => {
      const routed = preferClearStraightRoute(jog, source, target, []);
      expect(routed).toEqual([source.point, { x: 280, y: 58 }]);
      expect(routed[0]).toEqual(diamondBoundaryPort(diamond, 'right', 8));
      expect(jog.at(-1)).toEqual({ x: 280, y: 60 });
    });

    it('uses the same boundary rule for upward connections', () => {
      const start = { point: { x: 28, y: 200 }, side: 'top' as const };
      const end = {
        point: { x: 30, y: 20 },
        side: 'bottom' as const,
        range: [10, 50] as [number, number],
      };
      expect(
        preferClearStraightRoute(
          [start.point, { x: 28, y: 100 }, { x: 30, y: 100 }, end.point],
          start,
          end,
          [],
        ),
      ).toEqual([start.point, { x: 28, y: 20 }]);
    });

    it.each([
      { name: 'node', bounds: { x: 150, y: 45, width: 30, height: 30 } },
      { name: 'group', bounds: { x: 120, y: 40, width: 100, height: 50 } },
      { name: 'label clearance', bounds: { x: 150, y: 63, width: 30, height: 12 } },
    ])('keeps the safe detour when the direct corridor meets a $name', ({ bounds }) => {
      const detour = [
        source.point,
        { x: 100, y: 58 },
        { x: 100, y: 100 },
        { x: 260, y: 100 },
        { x: 260, y: 60 },
        target.point,
      ];
      const routed = preferClearStraightRoute(detour, source, target, [bounds]);
      expect(routed).toEqual(detour);
      expectOrthogonalRoute(routed);
      expectRouteAvoids(routed, bounds);
    });

    it.each([
      { start: { x: 120, y: 58 }, end: { x: 240, y: 58 } },
      { start: { x: 120, y: 64 }, end: { x: 240, y: 64 } },
      { start: { x: 170, y: 40 }, end: { x: 170, y: 80 } },
    ])('does not merge with, crowd, or cross an occupied route', (occupied) => {
      expect(preferClearStraightRoute(jog, source, target, [], [occupied])).toEqual(jog);
    });

    it('does not consume the neighboring target port capacity', () => {
      expect(
        preferClearStraightRoute(jog, source, target, [], [], [], [{ x: 280, y: 43 }]),
      ).toEqual(jog);
      expect(
        preferClearStraightRoute(jog, source, target, [], [], [], [{ x: 280, y: 42 }]),
      ).toHaveLength(2);
    });

    it('does not move fixed ports or move beyond the target boundary range', () => {
      expect(preferClearStraightRoute(jog, source, { ...target, range: undefined }, [])).toEqual(
        jog,
      );
      expect(preferClearStraightRoute(jog, source, { ...target, range: [60, 72] }, [])).toEqual(
        jog,
      );
    });

    it('preserves separate diamond ports while using a clear straight lane', () => {
      const occupied = [
        diamondBoundaryPort(diamond, 'right', -8),
        diamondBoundaryPort(diamond, 'bottom', 10),
      ];
      const routed = preferClearStraightRoute(jog, source, target, [], [], occupied);
      expect(routed).toHaveLength(2);
      expect(new Set([...occupied, routed[0]].map(({ x, y }) => `${x},${y}`)).size).toBe(3);
    });

    it('does not reverse a port normal or collapse a same-side return', () => {
      expect(preferClearStraightRoute(jog, source, { ...target, side: 'right' }, [])).toEqual(jog);
      expect(
        preferClearStraightRoute(jog, source, { ...target, point: { x: 20, y: 60 } }, []),
      ).toEqual(jog);
    });

    it('finds an available straight lane between occupied port slots', () => {
      const start = {
        point: { x: 100, y: 58 },
        side: 'right' as const,
        range: [30, 90] as [number, number],
      };
      const end = { ...target, range: [30, 90] as [number, number] };
      const ports = [
        { x: 280, y: 45 },
        { x: 280, y: 90 },
      ];
      const routed = preferClearStraightRoute(jog, start, end, [], [], [], ports);
      expect(routed).toHaveLength(2);
      expect(routed[0].y).toBe(routed[1].y);
      expect(routed[1].y).toBeGreaterThanOrEqual(61);
      expect(routed[1].y).toBeLessThanOrEqual(74);
    });
  });

  it('replaces directional wedges with compact open chevrons', () => {
    document.body.innerHTML = `<svg><defs>
      <marker id="diagram-pointEnd"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
      <marker id="diagram-pointStart"><path d="M 10 0 L 0 5 L 10 10 z" /></marker>
    </defs></svg>`;
    const svg = document.querySelector('svg') as unknown as SVGSVGElement;

    alignMermaidOpenArrowheads(svg);

    const markers = [...svg.querySelectorAll<SVGMarkerElement>('marker')];
    expect(markers.map((marker) => marker.dataset.diagramChevron)).toEqual(['true', 'true']);
    expect(markers.map((marker) => marker.querySelector('path')?.getAttribute('fill'))).toEqual([
      'none',
      'none',
    ]);
    expect(markers.map((marker) => marker.querySelector('path')?.getAttribute('d'))).toEqual([
      'M 3.5 0.5 L 6.5 3.5 L 3.5 6.5',
      'M 3.5 0.5 L 0.5 3.5 L 3.5 6.5',
    ]);
    expect(
      markers.every((marker) => {
        const values = marker
          .querySelector('path')!
          .getAttribute('d')!
          .match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)!
          .map(Number);
        const [x1, y1, tipX, tipY, x2, y2] = values;
        const first = { x: x1 - tipX, y: y1 - tipY };
        const second = { x: x2 - tipX, y: y2 - tipY };
        return Math.abs(first.x * second.x + first.y * second.y) < 0.001;
      }),
    ).toBe(true);
  });

  it('preserves directed route terminals while aligning arrowheads', () => {
    document.body.innerHTML = `<svg><defs>
      <marker id="diagram-pointEnd"><path /></marker>
    </defs><path id="route" d="M0,0L20,0" marker-end="url(#diagram-pointEnd)" /></svg>`;
    const svg = document.querySelector('svg') as unknown as SVGSVGElement;
    const route = svg.querySelector<SVGPathElement>('#route')!;

    alignMermaidOpenArrowheads(svg);

    expect(route.getAttribute('d')).toBe('M0,0L20,0');
  });

  it('preserves rounded corners while replacing the final endpoint', () => {
    const path = 'M 4 6 L 20 6 Q 26 6 26 12 L 26 30';

    expect(replacePathTerminal(path, { x: 26, y: 31 })).toBe('M 4 6 L 20 6 Q 26 6 26 12 L 26 31');
  });

  it('preserves comma-separated route coordinates', () => {
    expect(replacePathTerminal('M1,2L8,9', { x: 10.5, y: -3 })).toBe('M1,2L10.5,-3');
  });

  it('removes a terminal line that collapses onto a rounded corner endpoint', () => {
    expect(replacePathTerminal('M 4 6 Q 20 6 26 12 L 25 11', { x: 26, y: 12 })).toBe(
      'M 4 6 Q 20 6 26 12',
    );
  });

  it('does not rewrite a closed path without a terminal coordinate pair', () => {
    expect(replacePathTerminal('M 1 2 L 3 4 Z', { x: 5, y: 6 })).toBeNull();
  });

  it('removes duplicate points and collinear jogs before rounding', () => {
    expect(
      simplifyOrthogonalPoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ]);
    expect(
      buildRoundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ]),
    ).toBe('M 0 0 L 34 0 Q 40 0 40 6 L 40 30');
  });

  it.each(['edgePaths', 'transitions'])(
    'rounds %s state connectors with the shared inset',
    (containerClass) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('statediagram');
      svg.innerHTML = `<g class="${containerClass}"><path class="transition" data-edge="true" d="M 0 0 L 40 0 L 40 30" /></g>`;
      roundOrthogonalBends(svg);
      const path = svg.querySelector('path')!;
      // Numeric geometry: original endpoints, tangent points six units from the
      // corner, and the corner itself as the quadratic control point.
      expect(
        path
          .getAttribute('d')!
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number),
      ).toEqual([0, 0, 34, 0, 40, 0, 40, 6, 40, 30]);
      const rounded = path.getAttribute('d');
      roundOrthogonalBends(svg);
      expect(path.getAttribute('d')).toBe(rounded);
    },
  );

  it('clamps adjacent short bends without moving endpoints or doubling back', () => {
    const rounded = buildRoundedOrthogonalPath([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 4 },
      { x: 60, y: 4 },
    ]);
    expect(rounded.match(/-?\d+(?:\.\d+)?/g)!.map(Number)).toEqual([
      0, 0, 28, 0, 30, 0, 30, 2, 30, 2, 30, 4, 32, 4, 60, 4,
    ]);
  });

  it('keeps collinear state routes straight', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('statediagram');
    svg.innerHTML = '<path class="transition" data-edge="true" d="M 8 12 L 8 32 L 8 52" />';
    roundOrthogonalBends(svg);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M 8 12 L 8 32 L 8 52');
  });

  it('detours orthogonal routes outside unrelated node clearance', () => {
    const routed = routeOrthogonalAroundObstacles(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      [{ x: 30, y: 30, width: 40, height: 40 }],
      8,
    );

    expect(routed).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 22 },
      { x: 22, y: 22 },
      { x: 22, y: 78 },
      { x: 50, y: 78 },
      { x: 50, y: 100 },
    ]);
  });

  it('separates a crossing entry with a fixed departure and a clear target side', () => {
    const points = [
      { x: 150, y: 110 },
      { x: 150, y: 150 },
      { x: 75, y: 150 },
      { x: 75, y: 170 },
    ];
    const target = { x: 20, y: 170, width: 80, height: 40 };
    const occupied = [{ start: { x: 85, y: 170 }, end: { x: 85, y: 50 } }];
    const result = chooseClearStateEntryRoute(points, target, [], occupied);
    expect(result).toEqual([
      { x: 150, y: 110 },
      { x: 150, y: 190 },
      { x: 100, y: 190 },
    ]);
    expect(chooseClearStateEntryRoute(result, target, [], occupied)).toBe(result);
  });

  it('leaves already separate entry geometry unchanged', () => {
    const points = [
      { x: 50, y: 20 },
      { x: 50, y: 100 },
    ];
    expect(
      chooseClearStateEntryRoute(points, { x: 20, y: 100, width: 80, height: 40 }, [], []),
    ).toBe(points);
  });

  it('keeps the original when every local entry corridor is obstructed', () => {
    const points = [
      { x: 150, y: 110 },
      { x: 150, y: 150 },
      { x: 75, y: 150 },
      { x: 75, y: 170 },
    ];
    expect(
      chooseClearStateEntryRoute(
        points,
        { x: 20, y: 170, width: 80, height: 40 },
        [{ x: 0, y: 120, width: 180, height: 30 }],
        [{ start: { x: 85, y: 170 }, end: { x: 85, y: 50 } }],
      ),
    ).toBe(points);
  });

  it('uses the same bounded entry repair when the geometry is mirrored', () => {
    const points = [
      { x: -150, y: 110 },
      { x: -150, y: 150 },
      { x: -75, y: 150 },
      { x: -75, y: 170 },
    ];
    const result = chooseClearStateEntryRoute(
      points,
      { x: -100, y: 170, width: 80, height: 40 },
      [],
      [{ start: { x: -85, y: 170 }, end: { x: -85, y: 50 } }],
    );
    expect(result).toEqual([
      { x: -150, y: 110 },
      { x: -150, y: 190 },
      { x: -100, y: 190 },
    ]);
  });

  it('selects the unoccupied side when obstacle detours have equal length', () => {
    const routed = routeOrthogonalAroundObstacles(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      [{ x: 30, y: 30, width: 40, height: 40 }],
      8,
      [{ start: { x: 22, y: 22 }, end: { x: 22, y: 78 } }],
    );

    expect(routed.some((point) => point.x === 78)).toBe(true);
    expect(routed.some((point) => point.x === 22)).toBe(false);
  });

  it('keeps snapped cardinal ports connected by orthogonal segments', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 0, y: 20 },
        { x: 0, y: 80 },
      ],
      { x: 40, y: 30 },
      { x: 10, y: 110 },
      true,
    );

    expect(points[0]).toEqual({ x: 40, y: 30 });
    expect(points.at(-1)).toEqual({ x: 10, y: 110 });
    expect(
      points.slice(1).every((point, index) => {
        const previous = points[index];
        return point.x === previous.x || point.y === previous.y;
      }),
    ).toBe(true);
  });

  it('replaces a shared diagonal bend with two orthogonal bends', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 40, y: 30 },
        { x: 120, y: 110 },
        { x: 70, y: 110 },
      ],
      { x: 40, y: 30 },
      { x: 70, y: 110 },
      false,
    );

    expect(points).toEqual([
      { x: 40, y: 30 },
      { x: 55, y: 30 },
      { x: 55, y: 110 },
      { x: 70, y: 110 },
    ]);
  });

  it('rebuilds a route that retains an interior diagonal', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 180, y: 270 },
        { x: 120, y: 270 },
        { x: 225, y: 390 },
        { x: 230, y: 390 },
      ],
      { x: 180, y: 270 },
      { x: 230, y: 390 },
      false,
    );

    expect(points).toEqual([
      { x: 180, y: 270 },
      { x: 205, y: 270 },
      { x: 205, y: 390 },
      { x: 230, y: 390 },
    ]);
  });

  it('chooses one label segment with enough measured capacity', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 80 },
    ];

    expect(chooseLabelSegment(route, { width: 80, height: 20 })).toMatchObject({
      index: 1,
      horizontal: true,
      capacity: 120,
    });
    expect(
      chooseLabelSegment(route, { width: 80, height: 20 }, [
        { start: { x: 0, y: 40 }, end: { x: 120, y: 40 } },
      ]),
    ).toMatchObject({ index: 0, horizontal: false, capacity: 40 });
  });

  it('reserves the measured cluster title plus a stable content gap', () => {
    expect(measuredClusterHeaderHeight(36.2)).toBe(93);
    expect(measuredClusterHeaderHeight(12)).toBe(74);
  });

  it('intersects rays with the rhombus boundary instead of its rectangular bounds', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 80 };
    const center = { x: 60, y: 60 };

    expect(diamondRayIntersection(center, { x: 50, y: 40 }, bounds)).toEqual({ x: 85, y: 80 });
    expect(diamondRayIntersection(center, { x: 0, y: -40 }, bounds)).toEqual({ x: 60, y: 20 });
  });

  it('fans contested ports out along the diamond boundary', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 80 };
    const ports = [
      diamondBoundaryPort(bounds, 'right', -8),
      diamondBoundaryPort(bounds, 'right', 8),
      diamondBoundaryPort(bounds, 'top', -10),
      diamondBoundaryPort(bounds, 'top', 10),
    ];

    expect(new Set(ports.map(({ x, y }) => `${x},${y}`)).size).toBe(4);
    expect(
      ports.every(
        ({ x, y }) => Math.abs(Math.abs(x - 50) / 50 + Math.abs(y - 40) / 40 - 1) < 0.001,
      ),
    ).toBe(true);
    expect(diamondBoundaryPort(bounds, 'right')).toEqual({ x: 100, y: 40 });
  });

  it('builds top and right decision branch lanes from cardinal apexes', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const occupied = [source, { x: 200, y: 0, width: 80, height: 160 }];

    expect(
      buildFlowchartDecisionBranchPoints(
        source,
        { x: 200, y: 0, width: 80, height: 40 },
        'upper',
        occupied,
      ),
    ).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: -32 },
      { x: 240, y: -32 },
      { x: 240, y: 0 },
    ]);
    expect(
      buildFlowchartDecisionBranchPoints(
        source,
        { x: 200, y: 120, width: 80, height: 40 },
        'lower',
        occupied,
      ),
    ).toEqual([
      { x: 100, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 140 },
      { x: 200, y: 140 },
    ]);
  });

  it('keeps decision returns on a separate outer lane', () => {
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 200, y: 120, width: 80, height: 40 },
        { x: 0, y: 0, width: 100, height: 100 },
        [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 200, y: 120, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 240, y: 160 },
      { x: 240, y: 192 },
      { x: 50, y: 192 },
      { x: 50, y: 100 },
    ]);
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 10, y: 200, width: 80, height: 40 },
        { x: 10, y: 0, width: 80, height: 40 },
        [
          { x: 10, y: 0, width: 80, height: 40 },
          { x: 10, y: 200, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 50, y: 240 },
      { x: 50, y: 40 },
    ]);
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 10, y: 200, width: 80, height: 40 },
        { x: 0, y: 0, width: 100, height: 100 },
        [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 10, y: 200, width: 80, height: 40 },
        ],
        true,
      ),
    ).toEqual([
      { x: 50, y: 240 },
      { x: 50, y: 252 },
      { x: -28, y: 252 },
      { x: -28, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('separates compact decision branches around a vertically stacked diamond', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 10, y: 200, width: 80, height: 40 };
    const occupied = [source, target];

    const upper = buildFlowchartDecisionBranchPoints(source, target, 'upper', occupied, true);
    expect(upper).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
    ]);
    expectOrthogonalRoute(upper);
    expectRouteAvoids(upper, source);
    expectRouteAvoids(upper, target);
    expect(buildFlowchartDecisionBranchPoints(source, target, 'lower', occupied, true)).toEqual([
      { x: 100, y: 50 },
      { x: 132, y: 50 },
      { x: 132, y: 220 },
      { x: 90, y: 220 },
    ]);
  });

  it('keeps compact stacked branches orthogonal when the target is offset', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 140, y: 200, width: 80, height: 40 };

    const points = buildFlowchartDecisionBranchPoints(
      source,
      target,
      'upper',
      [source, target],
      true,
    );

    expectOrthogonalRoute(points);
    expectRouteAvoids(points, source);
    expectRouteAvoids(points, target);
  });

  it('routes compact stacked branches around an aligned intervening shape', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 10, y: 200, width: 80, height: 40 };
    const obstacle = { x: 35, y: 130, width: 30, height: 40 };

    const points = buildFlowchartDecisionBranchPoints(
      source,
      target,
      'upper',
      [source, obstacle, target],
      true,
    );

    expectOrthogonalRoute(points);
    expectRouteAvoids(points, source);
    expectRouteAvoids(points, obstacle);
    expectRouteAvoids(points, target);
  });

  it('builds a bounded feedback lane with centered perpendicular terminals', () => {
    const points = buildFlowchartFeedbackLanePoints(
      { x: -43, y: 734, width: 86, height: 42 },
      { x: -58, y: 0, width: 116, height: 42 },
      [
        { x: -78, y: 0, width: 156, height: 776 },
        { x: 0, y: 42, width: 126, height: 526 },
      ],
    );

    expect(points).toEqual([
      { x: 43, y: 755 },
      { x: 154, y: 755 },
      { x: 154, y: 804 },
      { x: -106, y: 804 },
      { x: -106, y: 54 },
      { x: 0, y: 54 },
      { x: 0, y: 42.25 },
    ]);
  });

  it('keeps a compact feedback lane close to its painted routes', () => {
    const points = buildFlowchartFeedbackLanePoints(
      { x: -36, y: 568, width: 72, height: 42 },
      { x: -41, y: 142, width: 82, height: 42 },
      [
        { x: -83, y: 42, width: 177, height: 526 },
        { x: -52, y: 0, width: 104, height: 610 },
      ],
      true,
    );

    expect(points).toEqual([
      { x: 36, y: 589 },
      { x: 64, y: 589 },
      { x: 64, y: 622 },
      { x: -95, y: 622 },
      { x: -95, y: 196 },
      { x: 0, y: 196 },
      { x: 0, y: 184.25 },
    ]);
  });

  it('separates a feedback target only when the same boundary side has competing ports', () => {
    const target = { x: 0, y: 0, width: 100, height: 40 };

    expect(chooseFlowchartFeedbackTargetX(target, [34, 50, 66])).toBe(26);
    expect(chooseFlowchartFeedbackTargetX(target, [26, 42, 58, 74])).toBe(50);
    expect(chooseFlowchartFeedbackTargetX(target, [])).toBe(50);
  });

  it('allocates an inside feedback slot only on an unoccupied straight boundary', () => {
    const target = { x: 0, y: 0, width: 100, height: 40, corner: { x: 16, y: 16 } };
    const ports = [42, 58];
    const slot = chooseFlowchartFeedbackInsideX(target, ports)!;
    expect(slot).toBeGreaterThanOrEqual(16);
    expect(slot).toBeLessThan(Math.min(...ports));
    expect(ports.every((p) => Math.abs(p - slot) >= 16)).toBe(true);
    expect(chooseFlowchartFeedbackInsideX(target, [20, 42, 58])).toBeUndefined();
    expect(chooseFlowchartFeedbackInsideX(target, [])).toBeUndefined();
    expect(chooseFlowchartFeedbackInsideX(target, [20, 80])).toBeUndefined();
  });

  it('builds grouped return routes on an external lane with side-center ports', () => {
    expect(
      buildGroupedReturnLanePoints(
        { x: 20, y: 400, width: 60, height: 40 },
        { x: 10, y: 20, width: 80, height: 40 },
        [
          { x: 0, y: 0, width: 120, height: 460 },
          { x: 10, y: 20, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 80, y: 420 },
      { x: 148, y: 420 },
      { x: 148, y: 40 },
      { x: 90, y: 40 },
    ]);

    expect(
      buildGroupedReturnLanePoints(
        { x: 20, y: 400, width: 60, height: 40 },
        { x: 10, y: 20, width: 80, height: 40 },
        [{ x: 0, y: 0, width: 120, height: 460 }],
        true,
      ),
    ).toEqual([
      { x: 80, y: 420 },
      { x: 138, y: 420 },
      { x: 138, y: 40 },
      { x: 90, y: 40 },
    ]);
  });
});

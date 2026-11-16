import { compactFlowchartLayouts, compactGroupedFlowchartLayouts } from './mermaid-compact-layout';
import { hitsShape, shapeOutline, shapePort } from './mermaid-shape-geometry';

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Curve = { d: string; points: Point[] };
type Route = Curve & {
  path: SVGPathElement;
  source: string;
  target: string;
  sourceBox: Box;
  targetBox: Box;
  label?: SVGGElement;
  labelBox?: Box;
};

const gap = 16;
const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const last = (points: Point[]) => points[points.length - 1];
const curveLength = (curve: Curve) =>
  curve.points.slice(1).reduce((sum, p, i) => sum + distance(curve.points[i], p), 0);

function ports(box: Box) {
  const c = center(box);
  return [
    [
      { x: c.x, y: box.y },
      { x: c.x, y: box.y - gap * 2 },
    ],
    [
      { x: box.x + box.width, y: c.y },
      { x: box.x + box.width + gap * 2, y: c.y },
    ],
    [
      { x: c.x, y: box.y + box.height },
      { x: c.x, y: box.y + box.height + gap * 2 },
    ],
    [
      { x: box.x, y: c.y },
      { x: box.x - gap * 2, y: c.y },
    ],
  ];
}
const inside = (p: Point, b: Box, padding = 0) =>
  p.x > b.x - padding &&
  p.x < b.x + b.width + padding &&
  p.y > b.y - padding &&
  p.y < b.y + b.height + padding;
const overlaps = (a: Box, b: Box, padding = 0) =>
  a.x < b.x + b.width + padding &&
  a.x + a.width + padding > b.x &&
  a.y < b.y + b.height + padding &&
  a.y + a.height + padding > b.y;
const containsBox = (outer: Box, inner: Box, padding = 0) =>
  inner.x >= outer.x + padding &&
  inner.y >= outer.y + padding &&
  inner.x + inner.width <= outer.x + outer.width - padding &&
  inner.y + inner.height <= outer.y + outer.height - padding;

function intersects(a: Point, b: Point, c: Point, d: Point, shared: Point[] = []) {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const det = cross(ab, cd);
  const ac = { x: c.x - a.x, y: c.y - a.y };
  if (Math.abs(det) < 0.0001) {
    const size = ab.x ** 2 + ab.y ** 2;
    if (size < 0.000001 || Math.abs(cross(ac, ab)) > 0.0001 * Math.sqrt(size)) return false;
    const project = (p: Point) => ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / size;
    const lo = Math.max(0, Math.min(project(c), project(d)));
    const hi = Math.min(1, Math.max(project(c), project(d)));
    if (hi < lo - 0.000001) return false;
    if ((hi - lo) * Math.sqrt(size) > 0.05) return true;
    const p = { x: a.x + ab.x * lo, y: a.y + ab.y * lo };
    return !shared.some((endpoint) => distance(p, endpoint) < 0.05);
  }
  const t = cross(ac, cd) / det;
  const u = cross(ac, ab) / det;
  if (t < -0.000001 || t > 1.000001 || u < -0.000001 || u > 1.000001) return false;
  const p = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return !shared.some((endpoint) => distance(p, endpoint) < 0.05);
}

function crosses(a: Point[], b: Point[]) {
  const shared = [a[0], last(a)].filter((p) =>
    [b[0], last(b)].some((other) => distance(p, other) < 0.05),
  );
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (intersects(a[i - 1], a[i], b[j - 1], b[j], shared)) return true;
    }
  }
  return false;
}

function hitsBox(points: Point[], box: Box, padding = 0) {
  const corners = [
    { x: box.x - padding, y: box.y - padding },
    { x: box.x + box.width + padding, y: box.y - padding },
    { x: box.x + box.width + padding, y: box.y + box.height + padding },
    { x: box.x - padding, y: box.y + box.height + padding },
  ];
  return (
    points.some((p) => inside(p, box, padding)) ||
    points
      .slice(1)
      .some((p, i) =>
        corners.some((corner, j) => intersects(points[i], p, corner, corners[(j + 1) % 4])),
      )
  );
}

function basis(points: Point[]): Curve {
  const first = points[0];
  const sampled = [first];
  let d = `M${first.x},${first.y}`;
  const weighted = (
    a: Point,
    b: Point,
    c: Point,
    wa: number,
    wb: number,
    wc: number,
    n: number,
  ) => ({ x: (a.x * wa + b.x * wb + c.x * wc) / n, y: (a.y * wa + b.y * wb + c.y * wc) / n });
  const line = (p: Point) => {
    d += `L${p.x},${p.y}`;
    sampled.push(p);
  };
  if (points.length < 3) {
    line(last(points));
    return { d, points: sampled };
  }
  line(weighted(first, points[1], first, 5, 1, 0, 6));
  for (let i = 2; i <= points.length; i++) {
    const a = points[i - 2],
      b = points[i - 1],
      c = points[Math.min(i, points.length - 1)];
    const start = last(sampled);
    const c1 = weighted(a, b, c, 2, 1, 0, 3);
    const c2 = weighted(a, b, c, 1, 2, 0, 3);
    const end = weighted(a, b, c, 1, 4, 1, 6);
    d += `C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
    const steps = Math.max(1, Math.min(16, Math.ceil(distance(start, end) / 12)));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps,
        u = 1 - t;
      sampled.push({
        x: u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y,
      });
    }
  }
  line(last(points));
  return { d, points: sampled };
}

function cubic(start: Point, c1: Point, c2: Point, end: Point): Curve {
  const steps = Math.max(
    12,
    Math.min(256, Math.ceil((distance(start, c1) + distance(c1, c2) + distance(c2, end)) / 5)),
  );
  return {
    d: `M${start.x},${start.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    points: Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps,
        u = 1 - t;
      return {
        x: u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y,
      };
    }),
  };
}

function peakCurvature(curve: Curve) {
  let peak = 0;
  for (let i = 1; i < curve.points.length - 1; i++) {
    const a = curve.points[i - 1],
      b = curve.points[i],
      c = curve.points[i + 1];
    const length = distance(a, b) * distance(b, c) * distance(c, a);
    if (length < 0.001) continue;
    peak = Math.max(
      peak,
      (2 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))) / length,
    );
  }
  return peak;
}

function turning(curve: Curve) {
  let total = 0;
  for (let i = 1; i < curve.points.length - 1; i++) {
    const a = curve.points[i - 1],
      b = curve.points[i],
      c = curve.points[i + 1];
    const ux = b.x - a.x,
      uy = b.y - a.y,
      vx = c.x - b.x,
      vy = c.y - b.y;
    total += Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
  }
  return total;
}

export function repairMermaidCurveCrossings(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  const grouped = Boolean(svg.querySelector('g.cluster'));
  const repaired = new Set<Route>();
  const paths = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link')];
  if (!paths.some((path) => path.getAttribute('d')?.includes('C'))) return;
  const reference = paths[0]?.getScreenCTM();
  if (!reference || paths.length > 64) return;
  const inverse = reference.inverse();
  const measure = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
    const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  };
  let headers = [...svg.querySelectorAll<SVGGraphicsElement>('g.cluster > .cluster-label')]
    .filter((label) => label.textContent?.trim())
    .map(measure);
  let groupBounds = [...svg.querySelectorAll<SVGRectElement>('g.cluster > rect')].map(measure);
  const nodes = new Map(
    [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const id = node.id.match(/flowchart-(.+)-\d+$/)?.[1];
      const shape = node.querySelector<SVGGraphicsElement>(':scope > .label-container');
      return id && shape
        ? [
            [
              id,
              {
                box: measure(shape),
                rect: shape.tagName.toLowerCase() === 'rect',
                element: node,
                outline: shapeOutline(shape, measure(shape), inverse),
              },
            ] as const,
          ]
        : [];
    }),
  );
  const nodePorts = (id: string, box: Box, slots = false) => {
    const node = nodes.get(id);
    const candidates = ports(box).flatMap((pair, side) => {
      const horizontal = side === 0 || side === 2;
      if (!slots || (horizontal ? box.width : box.height) < gap * 5) return [pair];
      return [
        pair,
        ...[-gap, gap].map((offset) =>
          pair.map((p) => ({
            x: p.x + (horizontal ? offset : 0),
            y: p.y + (horizontal ? 0 : offset),
          })),
        ),
      ];
    });
    return candidates.map((pair) =>
      node && !node.rect ? shapePort(box, node.outline, pair[0]) : pair,
    );
  };
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].filter(
    (label) => label.textContent?.trim(),
  );
  const routes: Route[] = paths.flatMap((path) => {
    const edge = path.id.match(/(?:^|-)L_(.*)_\d+$/)?.[1];
    const identities = edge
      ? [...nodes.keys()].flatMap((source) => {
          const target = edge.slice(source.length + 1);
          return edge.startsWith(`${source}_`) && nodes.has(target) ? [{ source, target }] : [];
        })
      : [];
    const identity = identities.length === 1 ? identities[0] : undefined;
    const source =
      [...path.classList].find((c) => c.startsWith('LS_'))?.slice(3) ?? identity?.source;
    const target =
      [...path.classList].find((c) => c.startsWith('LE_'))?.slice(3) ?? identity?.target;
    const matrix = path.getScreenCTM();
    const d = path.getAttribute('d');
    const sourceNode = source && nodes.get(source);
    const targetNode = target && nodes.get(target);
    if (!source || !target || !sourceNode || !targetNode || !matrix || !d) return [];
    if (Math.abs(matrix.e - reference.e) + Math.abs(matrix.f - reference.f) > 0.01) return [];
    const length = path.getTotalLength();
    const count = Math.max(2, Math.min(256, Math.ceil(length / 6)));
    const points = Array.from({ length: count + 1 }, (_, i) => {
      const p = path.getPointAtLength((length * i) / count);
      return { x: p.x, y: p.y };
    });
    const edgeId =
      svg.id && path.id.startsWith(`${svg.id}-`) ? path.id.slice(svg.id.length + 1) : path.id;
    const label = labels.find(
      (l) => l.querySelector(':scope > .label[data-id]')?.getAttribute('data-id') === edgeId,
    );
    return [
      {
        path,
        source,
        target,
        sourceBox: sourceNode.box,
        targetBox: targetNode.box,
        d,
        points,
        label,
        labelBox: label && measure(label),
      },
    ];
  });
  const directCurves = (route: Route): Curve[] => {
    const from = nodes.get(route.source),
      to = nodes.get(route.target);
    if (!from?.outline.length || !to?.outline.length) return [];
    const a = center(route.sourceBox),
      b = center(route.targetBox),
      span = distance(a, b);
    if (span < 1) return [];
    const unit = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
    const normal = { x: -unit.y, y: unit.x };
    return [0, -gap, gap, -gap * 2, gap * 2].flatMap((offset) => {
      const ray = (box: Box, sign: number) => {
        const c = center(box),
          size = Math.max(box.width, box.height);
        return {
          x: c.x + unit.x * size * sign + normal.x * offset,
          y: c.y + unit.y * size * sign + normal.y * offset,
        };
      };
      const [start] = shapePort(route.sourceBox, from.outline, ray(route.sourceBox, 1));
      const [end] = shapePort(route.targetBox, to.outline, ray(route.targetBox, -1));
      return [0, -gap, gap, -gap * 2, gap * 2, -gap * 3, gap * 3].map((bend) =>
        cubic(
          start,
          {
            x: start.x + (end.x - start.x) / 3 + normal.x * bend,
            y: start.y + (end.y - start.y) / 3 + normal.y * bend,
          },
          {
            x: end.x - (end.x - start.x) / 3 + normal.x * bend,
            y: end.y - (end.y - start.y) / 3 + normal.y * bend,
          },
          end,
        ),
      );
    });
  };
  const clear = (route: Route, curve: Curve, clearance = 8) =>
    !headers.some((box) => hitsBox(curve.points, box, clearance)) &&
    ![...nodes].some(([id, node]) => {
      const padding = id === route.source || id === route.target ? -0.1 : clearance;
      const points = curve.points.slice(1, -1);
      return node.rect || node.outline.length < 3
        ? hitsBox(points, node.box, padding)
        : hitsShape(points, node.box, node.outline, padding);
    });
  const crossingCount = () =>
    routes.reduce(
      (sum, route, i) =>
        sum + routes.slice(i + 1).filter((other) => crosses(route.points, other.points)).length,
      0,
    );
  const fitLabelWithinGroups = (route: Route, label: Box, groups = groupBounds) => {
    const common = groups.filter(
      (group) =>
        containsBox(group, route.sourceBox, -0.1) && containsBox(group, route.targetBox, -0.1),
    );
    const fitted = { ...label };
    for (const group of common) {
      fitted.x = Math.max(group.x + 6, Math.min(fitted.x, group.x + group.width - label.width - 6));
      fitted.y = Math.max(
        group.y + 6,
        Math.min(fitted.y, group.y + group.height - label.height - 6),
      );
    }
    return inside(center(label), fitted) &&
      distance(center(fitted), center(label)) <= gap * 2 &&
      common.every((group) => containsBox(group, fitted, 6))
      ? fitted
      : undefined;
  };
  const labelPlacement = (route: Route, curve: Curve, followCurve = true): Box | undefined => {
    if (!route.labelBox) return;
    const current = route.labelBox;
    const candidates = [
      ...(!followCurve ? [center(current)] : []),
      ...curve.points.filter((_, i) => i % 3 === 0),
    ];
    return candidates
      .flatMap((p) => {
        const box = fitLabelWithinGroups(route, {
          ...current,
          x: p.x - current.width / 2,
          y: p.y - current.height / 2,
        });
        return box ? [box] : [];
      })
      .filter(
        (box) =>
          ![...nodes.values()].some((n) => overlaps(box, n.box, 6)) &&
          !headers.some((header) => overlaps(box, header, 6)) &&
          !routes.some(
            (other) =>
              other !== route &&
              ((other.labelBox && overlaps(box, other.labelBox, 6)) ||
                hitsBox(other.points, box, 6)),
          ),
      )
      .toSorted(
        (a, b) => distance(center(a), center(current)) - distance(center(b), center(current)),
      )[0];
  };
  const conflicts = (route: Route, curve: Curve) =>
    routes.filter(
      (other) =>
        other !== route &&
        ((grouped
          ? route.target === other.target &&
            distance(last(curve.points), last(other.points)) < gap / 2
          : crosses(curve.points, other.points)) ||
          (other.labelBox && hitsBox(curve.points, other.labelBox, 6))),
    ).length + Number(grouped && !clear(route, curve));
  const write = (route: Route, curve: Curve, labelBox?: Box) => {
    if (grouped) repaired.add(route);
    route.d = curve.d;
    route.points = curve.points;
    route.path.setAttribute('d', curve.d);
    delete route.path.dataset.terminalGapBasePath;
    delete route.path.dataset.terminalDirection;
    delete route.path.dataset.terminalTarget;
    if (!labelBox || !route.label) return;
    const parent = (route.label.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
    if (!parent) return;
    const p = new DOMPoint(center(labelBox).x, center(labelBox).y)
      .matrixTransform(reference)
      .matrixTransform(parent.inverse());
    const local = route.label.getBBox();
    route.label.setAttribute(
      'transform',
      `translate(${p.x - local.x - local.width / 2},${p.y - local.y - local.height / 2})`,
    );
    route.labelBox = labelBox;
  };

  if (
    routes.length === paths.length &&
    routes.every((route) => route.d.includes('C')) &&
    [...nodes.values()].every((node) => node.outline.length >= 3)
  ) {
    const originalNodes = new Map(nodes);
    const originalRoutes = routes.map((route) => ({
      route,
      d: route.d,
      points: route.points,
      sourceBox: route.sourceBox,
      targetBox: route.targetBox,
      labelBox: route.labelBox,
    }));
    const originalLength = routes.reduce((sum, route) => sum + curveLength(route), 0);
    const originallyCrossed = routes.some((route) => conflicts(route, route) > 0);
    const originalHeaders = headers;
    const clusters = new Map(
      [...svg.querySelectorAll<SVGGElement>('g.cluster')].flatMap((element) => {
        const shape = element.querySelector<SVGRectElement>(':scope > rect');
        const label = element.querySelector<SVGGElement>(':scope > .cluster-label');
        if (!shape || !label) return [];
        const box = measure(shape),
          header = measure(label);
        const members = [...nodes]
          .filter(
            ([, node]) =>
              node.box.x >= box.x &&
              node.box.y >= box.y &&
              node.box.x + node.box.width <= box.x + box.width + 0.1 &&
              node.box.y + node.box.height <= box.y + box.height + 0.1,
          )
          .map(([id]) => id);
        return [
          [
            element.id,
            {
              box,
              members,
              headerWidth: header.width,
              headerHeight: header.height,
              header,
              shape,
              label,
            },
          ],
        ] as const;
      }),
    );
    const nodeBoxes = new Map([...nodes].map(([id, node]) => [id, node.box]));
    const layouts: { nodes: Map<string, Box>; groups?: Map<string, Box> }[] = grouped
      ? compactGroupedFlowchartLayouts(
          nodeBoxes,
          routes,
          clusters,
          svg.dataset.flowchartDirection ?? '',
        )
      : compactFlowchartLayouts(nodeBoxes, routes, svg.dataset.flowchartDirection).map((nodes) => ({
          nodes,
        }));
    const planCost = (curves: { curve: Curve }[]) =>
      curves.reduce(
        (sum, item, index) =>
          sum +
          curveLength(item.curve) +
          turning(item.curve) * gap * 2 +
          curves.slice(index + 1).filter((other) => crosses(item.curve.points, other.curve.points))
            .length *
            128,
        0,
      );
    const originalCost = planCost(routes.map((curve) => ({ curve })));
    let compact:
      | {
          boxes: Map<string, Box>;
          groups?: Map<string, Box>;
          headers?: Map<string, Box>;
          cost: number;
          curves: { route: Route; curve: Curve; labelBox?: Box }[];
        }
      | undefined;
    for (const layout of layouts)
      for (const anchored of grouped ? [false] : [false, true]) {
        const boxes = layout.nodes;
        const plannedGroups = layout.groups ? [...layout.groups.values()] : groupBounds;
        const groupHeaders = layout.groups
          ? new Map(
              [...layout.groups].flatMap(([id, box]) => {
                const cluster = clusters.get(id);
                if (!cluster) return [];
                const choices = [
                  (box.width - cluster.header.width) / 2,
                  20,
                  box.width - cluster.header.width - 20,
                ].map((offset) => ({ ...cluster.header, x: box.x + offset, y: box.y + 12 }));
                const hits = (header: Box) =>
                  routes.filter((route) => {
                    const from = boxes.get(route.source),
                      to = boxes.get(route.target);
                    return from && to && hitsBox([center(from), center(to)], header, gap);
                  }).length;
                return [[id, choices.toSorted((a, b) => hits(a) - hits(b))[0]]] as const;
              }),
            )
          : undefined;
        headers = groupHeaders ? [...groupHeaders.values()] : originalHeaders;
        for (const [id, node] of originalNodes)
          nodes.set(id, { ...node, box: boxes.get(id) ?? node.box });
        for (const route of routes) {
          route.sourceBox = boxes.get(route.source) ?? route.sourceBox;
          route.targetBox = boxes.get(route.target) ?? route.targetBox;
        }
        const anchors = new Map<
          Route,
          { start?: Point; lead?: Point; end?: Point; tail?: Point }
        >();
        for (const [id, box] of boxes) {
          const groups: Route[][] = [[], [], [], []];
          for (const route of routes.filter(
            (route) => route.source === id || route.target === id,
          )) {
            const other = center(route.source === id ? route.targetBox : route.sourceBox);
            const c = center(box);
            const dx = other.x - c.x,
              dy = other.y - c.y;
            groups[Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0].push(route);
          }
          groups.forEach((group, side) => {
            const horizontalSide = side === 0 || side === 2;
            group.sort((a, b) => {
              const other = (r: Route) => center(r.source === id ? r.targetBox : r.sourceBox);
              return (
                (horizontalSide ? other(a).x - other(b).x : other(a).y - other(b).y) ||
                routes.indexOf(a) - routes.indexOf(b)
              );
            });
            const spacing =
              group.length > 1
                ? Math.min(
                    gap * 1.5,
                    ((horizontalSide ? box.width : box.height) - gap * 2) / (group.length - 1),
                  )
                : 0;
            group.forEach((route, i) => {
              const offset = (i - (group.length - 1) / 2) * spacing;
              const [base, outside] = ports(box)[side];
              const nominal = {
                x: base.x + (horizontalSide ? offset : 0),
                y: base.y + (horizontalSide ? 0 : offset),
              };
              const node = nodes.get(id);
              const [p, lead] =
                node && !node.rect
                  ? shapePort(box, node.outline, nominal)
                  : [
                      nominal,
                      { x: nominal.x + outside.x - base.x, y: nominal.y + outside.y - base.y },
                    ];
              const record = anchors.get(route) ?? {};
              Object.assign(
                record,
                route.source === id ? { start: p, lead } : { end: p, tail: lead },
              );
              anchors.set(route, record);
            });
          });
        }
        const planned: { route: Route; curve: Curve; labelBox?: Box }[] = [];
        const ordered = routes.toSorted(
          (a, b) =>
            Number(Boolean(b.label)) - Number(Boolean(a.label)) ||
            distance(center(a.sourceBox), center(a.targetBox)) -
              distance(center(b.sourceBox), center(b.targetBox)),
        );
        for (const route of ordered) {
          const anchor = anchors.get(route);
          if (!anchor) break;
          if (!anchor.start || !anchor.lead || !anchor.end || !anchor.tail) break;
          let best: { curve: Curve; cost: number; labelBox?: Box } | undefined;
          const consider = (curve: Curve) => {
            const start = curve.points[0],
              end = last(curve.points);
            const occupied = planned.some(
              (other) =>
                (other.route.source === route.source &&
                  distance(start, other.curve.points[0]) < gap / 2) ||
                (other.route.target === route.source &&
                  distance(start, last(other.curve.points)) < gap / 2) ||
                (other.route.source === route.target &&
                  distance(end, other.curve.points[0]) < gap / 2) ||
                (other.route.target === route.target &&
                  distance(end, last(other.curve.points)) < gap / 2),
            );
            if (occupied || !clear(route, curve, gap)) return;
            if (planned.some((other) => other.labelBox && hitsBox(curve.points, other.labelBox, 6)))
              return;
            const crossings = planned.filter((other) =>
              crosses(curve.points, other.curve.points),
            ).length;
            if (crossings) return;
            if (grouped && turning(curve) > Math.PI * 0.6) return;
            const label = route.labelBox;
            const labelBox = label
              ? [0.5, 0.35, 0.65]
                  .flatMap((fraction) => {
                    const at = curve.points[Math.round((curve.points.length - 1) * fraction)];
                    const box = fitLabelWithinGroups(
                      route,
                      { ...label, x: at.x - label.width / 2, y: at.y - label.height / 2 },
                      plannedGroups,
                    );
                    return box ? [box] : [];
                  })
                  .find(
                    (box) =>
                      ![...nodes.values()].some((node) => overlaps(box, node.box, 6)) &&
                      !headers.some((header) => overlaps(box, header, 6)) &&
                      !planned.some(
                        (other) =>
                          (other.labelBox && overlaps(box, other.labelBox, 6)) ||
                          hitsBox(other.curve.points, box, 6),
                      ),
                  )
              : undefined;
            if (route.labelBox && !labelBox) return;
            const cost =
              curveLength(curve) +
              (anchored ? peakCurvature(curve) * gap ** 2 : turning(curve) * gap * 2) +
              crossings * 128;
            if (!best || cost < best.cost) best = { curve, cost, labelBox };
          };
          if (!anchored) directCurves(route).forEach(consider);
          const pairs = [
            [
              [anchor.start, anchor.lead],
              [anchor.end, anchor.tail],
            ],
            ...nodePorts(route.source, route.sourceBox)
              .flatMap((from) => nodePorts(route.target, route.targetBox).map((to) => [from, to]))
              .toSorted((a, b) => distance(a[0][0], a[1][0]) - distance(b[0][0], b[1][0])),
          ];
          for (const [[start, lead], [end, tail]] of pairs) {
            const occupied = (id: string, p: Point) =>
              planned.some(
                (other) =>
                  (other.route.source === id && distance(p, other.curve.points[0]) < gap / 2) ||
                  (other.route.target === id && distance(p, last(other.curve.points)) < gap / 2),
              );
            if (occupied(route.source, start) || occupied(route.target, end)) continue;
            const span = distance(start, end);
            for (const from of [0.5, 0.35, 0.23])
              for (const to of [0.5, 0.35, 0.23]) {
                const curve = cubic(
                  start,
                  {
                    x: start.x + ((lead.x - start.x) * span * from) / (gap * 2),
                    y: start.y + ((lead.y - start.y) * span * from) / (gap * 2),
                  },
                  {
                    x: end.x + ((tail.x - end.x) * span * to) / (gap * 2),
                    y: end.y + ((tail.y - end.y) * span * to) / (gap * 2),
                  },
                  end,
                );
                consider(curve);
              }
            if (anchored && best) break;
          }
          if (!best) break;
          planned.push({ route, curve: best.curve, labelBox: best.labelBox });
        }
        if (planned.length === routes.length) {
          for (const { route, curve } of planned) Object.assign(route, curve);
          const valid = planned.every((item) => !item.route.label || Boolean(item.labelBox));
          const length = planned.reduce((sum, item) => sum + curveLength(item.curve), 0);
          const cost = planCost(planned);
          if (
            valid &&
            length < originalLength * (grouped ? 0.99 : originallyCrossed ? 1.4 : 0.82) &&
            cost < (compact?.cost ?? (originallyCrossed && !grouped ? Infinity : originalCost))
          )
            compact = {
              boxes,
              groups: layout.groups,
              headers: groupHeaders,
              curves: planned,
              cost,
            };
        }
        for (const [id, record] of originalNodes) nodes.set(id, record);
        for (const { route, ...original } of originalRoutes) Object.assign(route, original);
      }
    headers = originalHeaders;
    if (compact) {
      const moves = [...originalNodes].flatMap(([id, node]) => {
        const box = compact.boxes.get(id);
        const transform = node.element.transform.baseVal.consolidate()?.matrix;
        const parent = (node.element.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
        return box && transform && parent ? [{ id, box, node, transform, parent }] : [];
      });
      const groupMoves = [...(compact.groups ?? [])].flatMap(([id, box]) => {
        const cluster = clusters.get(id);
        if (!cluster) return [];
        const matrix = cluster.shape.getScreenCTM()?.inverse();
        const parent = (cluster.label.parentElement as SVGGraphicsElement | null)
          ?.getScreenCTM()
          ?.inverse();
        return matrix && parent ? [{ id, box, cluster, matrix, parent }] : [];
      });
      if (moves.length === nodes.size && groupMoves.length === (compact.groups?.size ?? 0)) {
        for (const { id, box, cluster, matrix, parent } of groupMoves) {
          const a = new DOMPoint(box.x, box.y).matrixTransform(reference).matrixTransform(matrix);
          const b = new DOMPoint(box.x + box.width, box.y + box.height)
            .matrixTransform(reference)
            .matrixTransform(matrix);
          for (const [key, value] of Object.entries({
            x: a.x,
            y: a.y,
            width: b.x - a.x,
            height: b.y - a.y,
          }))
            cluster.shape.setAttribute(key, String(value));
          const header = compact.headers?.get(id);
          const target = new DOMPoint(
            (header?.x ?? box.x + 20) + cluster.header.width / 2,
            (header?.y ?? box.y + 12) + cluster.header.height / 2,
          )
            .matrixTransform(reference)
            .matrixTransform(parent);
          const local = cluster.label.getBBox();
          cluster.label.setAttribute(
            'transform',
            `translate(${target.x - local.x - local.width / 2},${target.y - local.y - local.height / 2})`,
          );
        }
        if (compact.groups) {
          headers = [...clusters.values()].map((cluster) => measure(cluster.label));
          groupBounds = [...clusters.values()].map((cluster) => measure(cluster.shape));
        }
        for (const { id, box, node, transform, parent } of moves) {
          const origin = new DOMPoint(0, 0)
            .matrixTransform(reference)
            .matrixTransform(parent.inverse());
          const p = new DOMPoint(box.x - node.box.x, box.y - node.box.y)
            .matrixTransform(reference)
            .matrixTransform(parent.inverse());
          node.element.setAttribute(
            'transform',
            `matrix(${transform.a},${transform.b},${transform.c},${transform.d},${transform.e + p.x - origin.x},${transform.f + p.y - origin.y})`,
          );
          nodes.set(id, { ...node, box });
        }
        for (const { route, curve, labelBox } of compact.curves) {
          route.sourceBox = compact.boxes.get(route.source) ?? route.sourceBox;
          route.targetBox = compact.boxes.get(route.target) ?? route.targetBox;
          write(route, curve, labelBox);
        }
      }
    }
  }

  // Reflow distant shared sinks before adding outer detours.
  for (const [id, record] of nodes) {
    const incoming = routes.filter((route) => route.target === id);
    if (
      grouped ||
      !record.rect ||
      incoming.length < 2 ||
      incoming.length > 4 ||
      incoming.some(
        (route) =>
          route.label || !route.d.includes('C') || !nodes.get(route.source)?.outline.length,
      ) ||
      routes.some((route) => route.source === id)
    )
      continue;
    const inputs = incoming.map((route) => center(route.sourceBox));
    const axis = /^(LR|RL)$/.test(svg.dataset.flowchartDirection ?? '') ? 'x' : 'y';
    const spread =
      Math.max(...inputs.map((p) => p[axis])) - Math.min(...inputs.map((p) => p[axis]));
    const spans = inputs.map((p) => distance(p, center(record.box)));
    if (
      spread < (axis === 'x' ? record.box.width : record.box.height) * 2 ||
      Math.max(...spans) < Math.min(...spans) * 2.5
    )
      continue;
    const transform = record.element.transform.baseVal.consolidate()?.matrix;
    const parent = (record.element.parentElement as SVGGraphicsElement | null)?.getScreenCTM();
    if (!transform || !parent) continue;
    const average = {
      x: inputs.reduce((sum, p) => sum + p.x, 0) / inputs.length,
      y: inputs.reduce((sum, p) => sum + p.y, 0) / inputs.length,
    };
    const others = routes.filter((route) => !incoming.includes(route));
    const otherNodes = [...nodes].filter(([key]) => key !== id).map(([, value]) => value.box);
    const nearby = otherNodes.filter(
      (box) =>
        box.x + box.width >= Math.min(...inputs.map((p) => p.x)) &&
        box.x <= Math.max(...inputs.map((p) => p.x)),
    );
    if (!nearby.length) continue;
    const top = Math.min(...nearby.map((box) => box.y)) - record.box.height - gap * 3;
    const bottom = Math.max(...nearby.map((box) => box.y + box.height)) + gap * 3;
    const previousLength = incoming.reduce((sum, route) => sum + curveLength(route), 0);
    let best: { box: Box; planned: { route: Route; curve: Curve }[]; cost: number } | undefined;
    for (const y of [top, bottom, average.y - record.box.height / 2]) {
      for (const offset of [0, -record.box.width / 2, record.box.width / 2]) {
        const box = { ...record.box, x: average.x - record.box.width / 2 + offset, y };
        if (
          otherNodes.some((other) => overlaps(box, other, 12)) ||
          others.some(
            (route) =>
              hitsBox(route.points, box, 8) || (route.labelBox && overlaps(box, route.labelBox, 8)),
          )
        )
          continue;
        nodes.set(id, { ...record, box });
        const planned: { route: Route; curve: Curve }[] = [];
        for (const route of incoming.toSorted((a, b) => curveLength(b) - curveLength(a))) {
          let chosen: { curve: Curve; length: number } | undefined;
          for (const [start, lead] of nodePorts(route.source, route.sourceBox))
            for (const [end, tail] of nodePorts(route.target, box)) {
              if (planned.some((other) => distance(end, last(other.curve.points)) < gap)) continue;
              const curve = basis([start, lead, tail, end]);
              if (
                !clear(route, curve) ||
                others.some(
                  (other) =>
                    crosses(curve.points, other.points) ||
                    (other.labelBox && hitsBox(curve.points, other.labelBox, 6)),
                ) ||
                planned.some((other) => crosses(curve.points, other.curve.points))
              )
                continue;
              const length = curveLength(curve);
              if (!chosen || length < chosen.length) chosen = { curve, length };
            }
          if (!chosen) break;
          planned.push({ route, curve: chosen.curve });
        }
        nodes.set(id, record);
        if (planned.length !== incoming.length) continue;
        const cost =
          planned.reduce((sum, item) => sum + curveLength(item.curve), 0) +
          distance(center(box), center(record.box)) * 0.15;
        if (cost < previousLength * 0.8 && (!best || cost < best.cost))
          best = { box, planned, cost };
      }
    }
    if (!best) continue;
    const origin = new DOMPoint(0, 0).matrixTransform(reference).matrixTransform(parent.inverse());
    const moved = new DOMPoint(best.box.x - record.box.x, best.box.y - record.box.y)
      .matrixTransform(reference)
      .matrixTransform(parent.inverse());
    record.element.setAttribute(
      'transform',
      `matrix(${transform.a},${transform.b},${transform.c},${transform.d},${transform.e + moved.x - origin.x},${transform.f + moved.y - origin.y})`,
    );
    nodes.set(id, { ...record, box: best.box });
    for (const { route, curve } of best.planned) {
      route.targetBox = best.box;
      write(route, curve);
    }
  }

  // Reuse the existing ports, ordering incoming curves by their source positions.
  for (const [id, target] of nodes) {
    if (!target.rect) continue;
    for (const side of ['left', 'right'] as const) {
      const x = target.box.x + (side === 'right' ? target.box.width : 0);
      const incoming = routes.filter(
        (r) => r.d.includes('C') && r.target === id && Math.abs(last(r.points).x - x) < 12,
      );
      if (
        incoming.length < 2 ||
        !incoming.some((r, i) => incoming.slice(i + 1).some((o) => crosses(r.points, o.points)))
      )
        continue;
      const ordered = incoming.toSorted((a, b) => center(a.sourceBox).y - center(b.sourceBox).y);
      const ports = incoming.map((r) => last(r.points)).toSorted((a, b) => a.y - b.y);
      const previous = incoming.map((r) => ({ route: r, d: r.d, points: r.points }));
      const before = incoming.reduce((sum, r) => sum + conflicts(r, r), 0);
      const previousCrossings = grouped ? crossingCount() : 0;
      const proposed = ordered.map((r, i) => {
        const end = last(r.points);
        return {
          route: r,
          curve: basis(
            r.points.map((p, j) => ({
              x: p.x + (ports[i].x - end.x) * (j / (r.points.length - 1)) ** 2,
              y: p.y + (ports[i].y - end.y) * (j / (r.points.length - 1)) ** 2,
            })),
          ),
        };
      });
      for (const { route, curve } of proposed) Object.assign(route, curve);
      const placements = proposed.map(({ route, curve }) => labelPlacement(route, curve));
      const after = incoming.reduce((sum, r) => sum + conflicts(r, r), 0);
      const valid = proposed.every(
        ({ route, curve }, i) => clear(route, curve) && (!route.label || placements[i]),
      );
      if (valid && after < before && (!grouped || crossingCount() <= previousCrossings))
        proposed.forEach(({ route, curve }, i) => write(route, curve, placements[i]));
      else for (const { route, d, points } of previous) Object.assign(route, { d, points });
    }
  }

  const boxes = [...nodes.values()].map((n) => n.box);
  if (!boxes.length) return;
  const outer = {
    left: Math.min(...boxes.map((b) => b.x)) - 64,
    right: Math.max(...boxes.map((b) => b.x + b.width)) + 64,
    top: Math.min(...boxes.map((b) => b.y)) - 64,
    bottom: Math.max(...boxes.map((b) => b.y + b.height)) + 64,
  };
  for (const route of routes.toSorted(
    (a, b) => b.path.getTotalLength() - a.path.getTotalLength(),
  )) {
    const before = conflicts(route, route);
    if (
      !before ||
      !route.d.includes('C') ||
      route.source === route.target ||
      !nodes.get(route.source)?.outline.length ||
      !nodes.get(route.target)?.outline.length
    )
      continue;
    let best: { curve: Curve; labelBox?: Box; conflicts: number; length: number } | undefined;
    const previousCrossings = grouped
      ? routes.filter((other) => other !== route && crosses(route.points, other.points)).length
      : 0;
    for (const [start, lead] of nodePorts(route.source, route.sourceBox))
      for (const [end, tail] of nodePorts(route.target, route.targetBox, grouped)) {
        const candidates = [
          [start, lead, tail, end],
          ...[outer.top, outer.bottom].flatMap((y) => [
            [start, lead, { x: lead.x, y }, { x: tail.x, y }, tail, end],
            ...[outer.left, outer.right].map((x) => [
              start,
              lead,
              { x: lead.x, y },
              { x, y },
              { x, y: tail.y },
              tail,
              end,
            ]),
          ]),
        ];
        const curves = candidates.map(basis);
        if (grouped) {
          const span = distance(start, end) / (gap * 2);
          for (const from of [0.5, 0.35, 0.23])
            for (const to of [0.5, 0.35, 0.23])
              curves.unshift(
                cubic(
                  start,
                  {
                    x: start.x + (lead.x - start.x) * span * from,
                    y: start.y + (lead.y - start.y) * span * from,
                  },
                  {
                    x: end.x + (tail.x - end.x) * span * to,
                    y: end.y + (tail.y - end.y) * span * to,
                  },
                  end,
                ),
              );
        }
        for (const curve of curves) {
          if (
            grouped &&
            routes.some(
              (other) =>
                other !== route &&
                route.target === other.target &&
                distance(last(curve.points), last(other.points)) < gap / 2,
            )
          )
            continue;
          if (!clear(route, curve)) continue;
          if (
            grouped &&
            routes.filter((other) => other !== route && crosses(curve.points, other.points))
              .length > previousCrossings
          )
            continue;
          const count = conflicts(route, curve);
          if (count >= before || (best && count > best.conflicts)) continue;
          const labelBox = labelPlacement(route, curve);
          if (route.label && !labelBox) continue;
          const length = curve.points
            .slice(1)
            .reduce((sum, p, i) => sum + distance(curve.points[i], p), 0);
          if (!best || count < best.conflicts || length < best.length)
            best = { curve, labelBox, conflicts: count, length };
        }
      }
    if (best) write(route, best.curve, best.labelBox);
  }

  // Prefer direct runs; round only as much as clearance and attachment require.
  for (const route of routes) {
    if (
      (grouped && !repaired.has(route)) ||
      !route.d.includes('C') ||
      route.source === route.target ||
      !nodes.get(route.source)?.outline.length ||
      !nodes.get(route.target)?.outline.length
    )
      continue;
    const start = route.points[0],
      end = last(route.points);
    const after = route.points.find((p) => distance(p, start) > 1);
    const before = route.points.findLast((p) => distance(p, end) > 1);
    if (!after || !before) continue;
    const span = distance(start, end);
    const originalLength = curveLength(route);
    const initial = peakCurvature(route);
    if (initial < 0.0001) continue;
    const from = distance(start, after),
      to = distance(end, before);
    const originalCost = originalLength + turning(route) * gap * 2;
    const originalCrossings = routes.filter(
      (other) => other !== route && crosses(route.points, other.points),
    ).length;
    let best: { curve: Curve; labelBox?: Box; cost: number } | undefined;
    const candidates = directCurves(route);
    for (const outgoing of [0.5, 0.35, 0.23, 0.15, 0.08]) {
      for (const incoming of [0.5, 0.35, 0.23, 0.15, 0.08]) {
        const curve = cubic(
          start,
          {
            x: start.x + ((after.x - start.x) * span * outgoing) / from,
            y: start.y + ((after.y - start.y) * span * outgoing) / from,
          },
          {
            x: end.x + ((before.x - end.x) * span * incoming) / to,
            y: end.y + ((before.y - end.y) * span * incoming) / to,
          },
          end,
        );
        candidates.push(curve);
      }
    }
    for (const curve of candidates) {
      const cost = curveLength(curve) + turning(curve) * gap * 2;
      if (
        cost >= (best?.cost ?? originalCost * 0.98) ||
        peakCurvature(curve) > Math.max(initial, 1 / gap) ||
        curveLength(curve) > originalLength + gap / 2 ||
        !clear(route, curve, gap) ||
        conflicts(route, curve) ||
        (grouped &&
          routes.filter((other) => other !== route && crosses(curve.points, other.points)).length >
            originalCrossings)
      )
        continue;
      const labelBox = labelPlacement(route, curve, true);
      if (route.label && !labelBox) continue;
      best = { curve, labelBox, cost };
    }
    if (best) write(route, best.curve, best.labelBox);
  }
}

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

function intersects(a: Point, b: Point, c: Point, d: Point) {
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
  if (Math.abs(det) < 0.0001) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(ac, cd) / det;
  const u = cross(ac, ab) / det;
  return t > 0.0001 && t < 0.9999 && u > 0.0001 && u < 0.9999;
}

function crosses(a: Point[], b: Point[]) {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (intersects(a[i - 1], a[i], b[j - 1], b[j])) return true;
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

export function repairMermaidCurveCrossings(svg: SVGSVGElement) {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2' || svg.querySelector('g.cluster'))
    return;
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
  const nodes = new Map(
    [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const id = node.id.match(/flowchart-(.+)-\d+$/)?.[1];
      const shape = node.querySelector<SVGGraphicsElement>(':scope > .label-container');
      return id && shape
        ? [
            [
              id,
              { box: measure(shape), rect: shape.tagName.toLowerCase() === 'rect', element: node },
            ] as const,
          ]
        : [];
    }),
  );
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
    const label = labels.find((l) => {
      const id = l.querySelector('[data-id]')?.getAttribute('data-id');
      return id && path.id.endsWith(id);
    });
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
  const clear = (route: Route, curve: Curve, clearance = 8) =>
    ![...nodes].some(([id, node]) =>
      hitsBox(
        curve.points.slice(1, -1),
        node.box,
        id === route.source || id === route.target ? -0.1 : clearance,
      ),
    );
  const labelPlacement = (route: Route, curve: Curve, followCurve = false): Box | undefined => {
    if (!route.labelBox) return;
    const current = route.labelBox;
    const candidates = [
      ...(!followCurve ? [center(current)] : []),
      ...curve.points.filter((_, i) => i % 3 === 0),
    ];
    return candidates
      .map((p) => ({ ...current, x: p.x - current.width / 2, y: p.y - current.height / 2 }))
      .filter(
        (box) =>
          ![...nodes.values()].some((n) => overlaps(box, n.box, 6)) &&
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
        (crosses(curve.points, other.points) ||
          (other.labelBox && hitsBox(curve.points, other.labelBox, 6))),
    ).length;
  const write = (route: Route, curve: Curve, labelBox?: Box) => {
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

  // Reflow distant shared sinks before adding outer detours.
  for (const [id, record] of nodes) {
    const incoming = routes.filter((route) => route.target === id);
    if (
      !record.rect ||
      incoming.length < 2 ||
      incoming.length > 4 ||
      incoming.some(
        (route) => route.label || !route.d.includes('C') || !nodes.get(route.source)?.rect,
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
          for (const [start, lead] of ports(route.sourceBox))
            for (const [end, tail] of ports(box)) {
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
      if (valid && after < before)
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
      !nodes.get(route.source)?.rect ||
      !nodes.get(route.target)?.rect
    )
      continue;
    let best: { curve: Curve; labelBox?: Box; conflicts: number; length: number } | undefined;
    for (const [start, lead] of ports(route.sourceBox))
      for (const [end, tail] of ports(route.targetBox)) {
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
        for (const candidate of candidates) {
          const curve = basis(candidate);
          if (!clear(route, curve)) continue;
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

  // Spread each bend along the connection instead of concentrating it at a port.
  for (const route of routes) {
    if (
      !route.d.includes('C') ||
      route.source === route.target ||
      !nodes.get(route.source)?.rect ||
      !nodes.get(route.target)?.rect
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
    let best: { curve: Curve; labelBox?: Box; curvature: number } | undefined;
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
        const curvature = peakCurvature(curve);
        if (
          curvature >= (best?.curvature ?? initial * 0.85) ||
          curveLength(curve) > originalLength * 1.1 + gap ||
          !clear(route, curve, gap) ||
          conflicts(route, curve)
        )
          continue;
        const labelBox = labelPlacement(route, curve, true);
        if (route.label && !labelBox) continue;
        best = { curve, labelBox, curvature };
      }
    }
    if (best) write(route, best.curve, best.labelBox);
  }
}

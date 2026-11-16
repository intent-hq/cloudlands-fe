type Box = { x: number; y: number; width: number; height: number };
type Edge = { source: string; target: string; labelBox?: Box };
type Position = { u: number; v: number; width: number; height: number };

function nodeValue<T>(nodes: ReadonlyMap<string, T>, id: string): T {
  const node = nodes.get(id);
  if (node === undefined) throw new Error('Compact flowchart references an unknown node');
  return node;
}

export function compactFlowchartLayouts(
  boxes: ReadonlyMap<string, Box>,
  edges: readonly Edge[],
  direction = 'TB',
): Map<string, Box>[] {
  if (boxes.size > 48 || edges.some((e) => !boxes.has(e.source) || !boxes.has(e.target))) return [];
  const horizontal = /^(LR|RL)$/.test(direction);
  const sign = /^(RL|BT)$/.test(direction) ? -1 : 1;
  const gap = 64;
  const positions = new Map(
    [...boxes].map(([id, b]) => [
      id,
      {
        u: sign * (horizontal ? b.x + b.width / 2 : b.y + b.height / 2),
        v: horizontal ? b.y + b.height / 2 : b.x + b.width / 2,
        width: horizontal ? b.width : b.height,
        height: horizontal ? b.height : b.width,
      },
    ]),
  );
  const incoming = (id: string) => edges.filter((e) => e.target === id);
  const outgoing = (id: string) => edges.filter((e) => e.source === id);
  const walk = (start: string, reverse = false, blocked = new Set<string>()) => {
    const found = new Set<string>();
    const pending = [start];
    for (let id; (id = pending.pop()) !== undefined;) {
      if (found.has(id) || blocked.has(id)) continue;
      found.add(id);
      pending.push(
        ...(reverse ? incoming(id) : outgoing(id)).map((e) => (reverse ? e.source : e.target)),
      );
    }
    return found;
  };
  const reachable = new Map([...boxes.keys()].map((id) => [id, walk(id)]));
  const visited = new Set<string>();
  const components = [...boxes.keys()].flatMap((id) => {
    if (visited.has(id)) return [];
    const members = [...boxes.keys()].filter(
      (other) => reachable.get(id)?.has(other) && reachable.get(other)?.has(id),
    );
    members.forEach((member) => visited.add(member));
    return members.length >= 3 && members.length <= 8 ? [members] : [];
  });
  const results: Map<string, Box>[] = [];
  const output = (placed: ReadonlyMap<string, Position>) => {
    const result = new Map(
      [...placed].map(([id, p]) => {
        const original = nodeValue(boxes, id);
        return [
          id,
          {
            ...original,
            x: (horizontal ? sign * p.u : p.v) - original.width / 2,
            y: (horizontal ? p.v : sign * p.u) - original.height / 2,
          },
        ] as const;
      }),
    );
    const all = [...result.values()];
    return all.some((a, i) =>
      all
        .slice(i + 1)
        .some(
          (b) =>
            a.x < b.x + b.width + 16 &&
            a.x + a.width + 16 > b.x &&
            a.y < b.y + b.height + 16 &&
            a.y + a.height + 16 > b.y,
        ),
    )
      ? undefined
      : result;
  };
  const ids = [...boxes.keys()];
  for (let i = 0; i < ids.length && results.length < 8; i++)
    for (let j = i + 1; j < ids.length && results.length < 8; j++) {
      const pair = [ids[i], ids[j]];
      const destinations = [...new Set(outgoing(pair[0]).map((e) => e.target))].filter(
        (id) => !pair.includes(id) && outgoing(pair[1]).some((e) => e.target === id),
      );
      if (destinations.length !== 2) continue;
      const roots = [...new Set(incoming(pair[0]).map((e) => e.source))].filter(
        (id) =>
          !pair.includes(id) &&
          !destinations.includes(id) &&
          incoming(pair[1]).some((e) => e.source === id),
      );
      const joins = [...new Set(outgoing(destinations[0]).map((e) => e.target))].filter(
        (id) =>
          !pair.includes(id) &&
          !destinations.includes(id) &&
          outgoing(destinations[1]).some((e) => e.target === id),
      );
      if (
        roots.length !== 1 ||
        joins.length !== 1 ||
        new Set([...pair, ...destinations, ...roots, ...joins]).size !== 6
      )
        continue;
      const placed = new Map([...positions].map(([id, p]) => [id, { ...p }]));
      const parent = nodeValue(placed, roots[0]);
      const branches = pair.toSorted((a, b) => nodeValue(placed, a).v - nodeValue(placed, b).v);
      const outcomes = destinations.toSorted(
        (a, b) =>
          outgoing(a).filter((e) => pair.includes(e.target)).length -
          outgoing(b).filter((e) => pair.includes(e.target)).length,
      );
      const middle = nodeValue(placed, outcomes[0]),
        outside = nodeValue(placed, outcomes[1]),
        join = nodeValue(placed, joins[0]);
      const u = Math.max(
        Math.min(...pair.map((id) => nodeValue(placed, id).u)),
        parent.u +
          parent.width / 2 +
          gap +
          Math.max(...pair.map((id) => nodeValue(placed, id).width / 2)),
      );
      const spread =
        Math.max(...pair.map((id) => nodeValue(placed, id).height / 2)) + middle.height / 2 + gap;
      branches.forEach((id, index) =>
        Object.assign(nodeValue(placed, id), { u, v: parent.v + (index ? 1 : -1) * spread }),
      );
      Object.assign(middle, { u, v: parent.v });
      Object.assign(join, { u: u + middle.width / 2 + gap + join.width / 2, v: parent.v });
      Object.assign(outside, { u: join.u + join.width / 2 + gap + outside.width / 2, v: parent.v });
      const candidate = output(placed);
      if (candidate) results.push(candidate);
    }
  for (const members of components) {
    const core = new Set(members);
    const entries = edges.filter((e) => !core.has(e.source) && core.has(e.target));
    const exits = edges.filter((e) => core.has(e.source) && !core.has(e.target));
    const entry = entries.toSorted(
      (a, b) => walk(b.source, true, core).size - walk(a.source, true, core).size,
    )[0];
    const exit = exits.toSorted(
      (a, b) =>
        walk(b.target, false, core).size / incoming(b.target).length -
        walk(a.target, false, core).size / incoming(a.target).length,
    )[0];
    if (!entry || !exit) continue;
    const pending = [entry.target];
    const previous = new Map<string, string | undefined>([[entry.target, undefined]]);
    for (let i = 0; i < pending.length && !previous.has(exit.source); i++) {
      const current = pending[i];
      for (const e of outgoing(current)) {
        if (!core.has(e.target) || previous.has(e.target)) continue;
        previous.set(e.target, current);
        pending.push(e.target);
      }
    }
    if (!previous.has(exit.source)) continue;
    const spine: string[] = [];
    for (let id: string | undefined = exit.source; id !== undefined; id = previous.get(id))
      spine.unshift(id);
    const satellites = members
      .filter((id) => !spine.includes(id))
      .toSorted((a, b) => {
        const neighbors = (id: string) =>
          new Set(
            edges.flatMap((e) =>
              e.source === id && core.has(e.target)
                ? [e.target]
                : e.target === id && core.has(e.source)
                  ? [e.source]
                  : [],
            ),
          ).size;
        return neighbors(b) - neighbors(a);
      });
    for (const flip of [-1, 1]) {
      const placed = new Map([...positions].map(([id, p]) => [id, { ...p }]));
      const parent = nodeValue(placed, entry.source);
      const first = nodeValue(placed, spine[0]);
      first.u = Math.max(first.u, parent.u + parent.width / 2 + gap + first.width / 2);
      const row = parent.v;
      first.v = row;
      for (let i = 1; i < spine.length; i++) {
        const previous = nodeValue(placed, spine[i - 1]);
        const current = nodeValue(placed, spine[i]);
        current.u = previous.u + previous.width / 2 + gap + current.width / 2;
        current.v = row;
      }
      const spineHalf = Math.max(...spine.map((id) => nodeValue(placed, id).height / 2));
      const satelliteHeight = Math.max(0, ...satellites.map((id) => nodeValue(placed, id).height));
      for (const [index, id] of satellites.entries()) {
        const neighbors = new Set(
          edges
            .flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []))
            .filter((other) => spine.includes(other)),
        );
        const current = nodeValue(placed, id);
        current.u = neighbors.size
          ? [...neighbors].reduce((sum, other) => sum + nodeValue(placed, other).u, 0) /
            neighbors.size
          : first.u;
        const labelSpace = Math.max(
          0,
          ...edges.flatMap((e) =>
            (e.source === id || e.target === id) && e.labelBox
              ? [horizontal ? e.labelBox.height : e.labelBox.width]
              : [],
          ),
        );
        current.v =
          row +
          flip *
            (index % 2 === 0 ? 1 : -1) *
            (spineHalf +
              gap +
              labelSpace +
              current.height / 2 +
              Math.floor(index / 2) * (satelliteHeight + gap));
      }
      for (const e of entries) {
        if (incoming(e.source).length || outgoing(e.source).length !== 1) continue;
        const target = nodeValue(placed, e.target);
        const source = nodeValue(placed, e.source);
        source.u = target.u;
        source.v =
          target.v +
          (Math.sign(target.v - row) || flip) * (target.height / 2 + gap + source.height / 2);
      }
      const extended = new Set(members);
      for (const e of exits) {
        let sourceId = e.source,
          targetId = e.target;
        while (
          !extended.has(targetId) &&
          incoming(targetId).length === 1 &&
          outgoing(targetId).length <= 1
        ) {
          const source = nodeValue(placed, sourceId),
            target = nodeValue(placed, targetId);
          target.u = source.u + source.width / 2 + gap + target.width / 2;
          target.v = source.v;
          extended.add(targetId);
          const next = outgoing(targetId)[0];
          if (!next) break;
          sourceId = targetId;
          targetId = next.target;
        }
      }
      let variants = [placed];
      for (const [id, initial] of placed) {
        const inputs = incoming(id);
        if (core.has(id) || outgoing(id).length || inputs.length < 2 || inputs.length > 4) continue;
        const alternatives: { positions: Map<string, Position>; cost: number }[] = [];
        for (const variant of variants) {
          const parents = inputs.map((e) => nodeValue(variant, e.source));
          const u = parents.reduce((sum, p) => sum + p.u, 0) / parents.length;
          const above =
            Math.min(...parents.map((p) => p.v - p.height / 2)) - gap - initial.height / 2;
          const below =
            Math.max(...parents.map((p) => p.v + p.height / 2)) + gap + initial.height / 2;
          for (const v of [
            above,
            below,
            ...parents.map((p) => p.v),
            parents.reduce((sum, p) => sum + p.v, 0) / parents.length,
          ])
            for (const nextU of [
              u,
              u - initial.width / 2,
              u + initial.width / 2,
              u - initial.width,
              u + initial.width,
              ...parents.map((p) => p.u),
            ]) {
              const candidate = { ...initial, u: nextU, v };
              if (
                [...variant].some(
                  ([other, p]) =>
                    other !== id &&
                    Math.abs(p.u - candidate.u) < (p.width + candidate.width) / 2 + gap / 2 &&
                    Math.abs(p.v - candidate.v) < (p.height + candidate.height) / 2 + gap / 2,
                )
              )
                continue;
              const next = new Map(variant);
              next.set(id, candidate);
              const cost = parents.reduce(
                (sum, p) => sum + Math.hypot(p.u - candidate.u, p.v - candidate.v),
                0,
              );
              alternatives.push({ positions: next, cost });
            }
        }
        if (alternatives.length)
          variants = alternatives
            .toSorted((a, b) => a.cost - b.cost)
            .slice(0, 3)
            .map((a) => a.positions);
      }
      for (const variant of variants) {
        const output = new Map(
          [...variant].map(([id, p]) => {
            const original = nodeValue(boxes, id);
            const x = horizontal ? sign * p.u : p.v;
            const y = horizontal ? p.v : sign * p.u;
            return [id, { ...original, x: x - original.width / 2, y: y - original.height / 2 }];
          }),
        );
        const all = [...output.values()];
        if (
          all.some((a, i) =>
            all
              .slice(i + 1)
              .some(
                (b) =>
                  a.x < b.x + b.width + 16 &&
                  a.x + a.width + 16 > b.x &&
                  a.y < b.y + b.height + 16 &&
                  a.y + a.height + 16 > b.y,
              ),
          )
        )
          continue;
        results.push(output);
      }
    }
  }
  return results;
}

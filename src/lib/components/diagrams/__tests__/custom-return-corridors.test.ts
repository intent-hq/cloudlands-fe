import { describe, expect, it } from 'vitest';

import type { DiagramBaseView, DiagramModel, DiagramState } from '$shared/types/notes-primitives';
import { computeLayout, measureEdgeLabel } from '../layout-engine';
import type { ComputedEdge, ComputedLayout, ComputedNode } from '../types';

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type Walkthrough = {
  grammar: string;
  model: DiagramModel;
  baseView: DiagramBaseView;
  state: DiagramState;
  returnId: string;
};

// Exact models and active states from note bf4d5bc8-15d8-4dff-8bca-e6cd6f1704b7.
// Unlike the preview fixture these have neither authored positions nor sizes.
const walkthroughs: Walkthrough[] = [
  {
    grammar: 'architecture',
    model: {
      nodes: [
        { id: 'response', label: 'Live response', kind: 'ui_component', semanticStyle: 'active' },
        { id: 'tool', label: 'Tool activity', kind: 'process', semanticStyle: 'warning' },
        { id: 'composer', label: 'Composer', kind: 'control', semanticStyle: 'inactive' },
        { id: 'retry', label: 'Retry action', kind: 'action', semanticStyle: 'danger' },
      ],
      edges: [
        { id: 's1', from: 'response', to: 'tool', label: 'starts work' },
        { id: 's2', from: 'tool', to: 'response', label: 'returns result' },
        { id: 's3', from: 'response', to: 'composer', label: 'asks for input' },
        { id: 's4', from: 'retry', to: 'response', label: 'starts new request' },
      ],
    },
    baseView: {
      layout: { type: 'layered', direction: 'LR', spacing: 64, edgeRouting: 'orthogonal' },
    },
    state: {
      id: 'working',
      label: 'Working',
      visibleNodes: ['response', 'tool', 'composer'],
      visibleEdges: ['s1', 's2'],
      highlightedNodes: ['tool'],
      narrative: {
        title: 'Tool work stays inside the response',
        text: 'The composer remains available while the active tool is emphasized.',
      },
    },
    returnId: 's2',
  },
  {
    grammar: 'sequence',
    model: {
      nodes: [
        { id: 'user', label: 'User', kind: 'actor' },
        { id: 'chat', label: 'Chat UI', kind: 'ui_component' },
        { id: 'redux', label: 'Redux', kind: 'store' },
        { id: 'daemon', label: 'Daemon', kind: 'service' },
      ],
      edges: [
        { id: 'w1', from: 'user', to: 'chat', label: 'send message' },
        { id: 'w2', from: 'chat', to: 'redux', label: 'dispatch request' },
        { id: 'w3', from: 'redux', to: 'daemon', label: 'start turn' },
        { id: 'w4', from: 'daemon', to: 'redux', label: 'stream state events' },
        { id: 'w5', from: 'redux', to: 'chat', label: 'render current state' },
      ],
    },
    baseView: {
      layout: { type: 'layered', direction: 'LR', spacing: 68, edgeRouting: 'orthogonal' },
    },
    state: {
      id: 'execute',
      label: '2. Execute',
      visibleNodes: ['chat', 'redux', 'daemon'],
      visibleEdges: ['w2', 'w3', 'w4'],
      highlightedNodes: ['daemon'],
      camera: { focus: 'daemon', zoom: 1.1 }, // protocol-version-ok: camera zoom; daemon is a node ID
      narrative: {
        title: '2. Follow execution',
        text: 'The daemon runs the turn and streams state events back.',
      },
      transition: {
        duration: 250,
        animate: ['camera', 'visibleNodes', 'visibleEdges', 'semanticStyle'],
      },
    },
    returnId: 'w4',
  },
];

function stateLayout(example: Walkthrough, spacingCap: number) {
  const visible = new Set(example.state.visibleNodes);
  return computeLayout(
    {
      nodes: example.model.nodes.filter(({ id }) => visible.has(id)),
      edges: example.model.edges.filter(
        (edge) =>
          example.state.visibleEdges!.includes(edge.id) &&
          visible.has(edge.from) &&
          visible.has(edge.to),
      ),
    },
    {
      layout: {
        ...example.baseView.layout,
        spacing: Math.min(example.baseView.layout.spacing!, spacingCap),
      },
    },
    example.grammar,
  );
}

function enters(start: Point, end: Point, box: Bounds, padding = 0) {
  return (
    Math.max(start.x, end.x) > box.x - padding + 0.001 &&
    Math.min(start.x, end.x) < box.x + box.width + padding - 0.001 &&
    Math.max(start.y, end.y) > box.y - padding + 0.001 &&
    Math.min(start.y, end.y) < box.y + box.height + padding - 0.001
  );
}

function expectAttachment(point: Point, adjacent: Point, node: ComputedNode) {
  expect(
    (point.x === node.x && adjacent.x < point.x && adjacent.y === point.y) ||
      (point.x === node.x + node.width && adjacent.x > point.x && adjacent.y === point.y) ||
      (point.y === node.y && adjacent.y < point.y && adjacent.x === point.x) ||
      (point.y === node.y + node.height && adjacent.y > point.y && adjacent.x === point.x),
  ).toBe(true);
  expect(point.x).toBeGreaterThanOrEqual(node.x);
  expect(point.x).toBeLessThanOrEqual(node.x + node.width);
  expect(point.y).toBeGreaterThanOrEqual(node.y);
  expect(point.y).toBeLessThanOrEqual(node.y + node.height);
}

function expectClearRoutes(layout: ComputedLayout) {
  for (const edge of layout.edges) {
    const points = edge.points!;
    expectAttachment(
      points[0],
      points[1],
      layout.nodes.find(({ id }) => id === edge.from)!,
    );
    expectAttachment(
      points.at(-1)!,
      points.at(-2)!,
      layout.nodes.find(({ id }) => id === edge.to)!,
    );
    for (const [index, end] of points.slice(1).entries()) {
      const start = points[index];
      expect(start.x === end.x || start.y === end.y).toBe(true);
      expect(start).not.toEqual(end);
      for (const node of layout.nodes) {
        expect(
          enters(start, end, node),
          `${edge.id}/${node.id}: ${JSON.stringify({ start, end, node })}`,
        ).toBe(false);
      }
      for (const other of layout.edges.filter((other) => other !== edge)) {
        for (const [i, otherEnd] of other.points!.slice(1).entries()) {
          const otherStart = other.points![i];
          expect(
            enters(start, end, {
              x: Math.min(otherStart.x, otherEnd.x) - 0.5,
              y: Math.min(otherStart.y, otherEnd.y) - 0.5,
              width: Math.abs(otherEnd.x - otherStart.x) + 1,
              height: Math.abs(otherEnd.y - otherStart.y) + 1,
            }),
            `${edge.id}/${other.id}`,
          ).toBe(false);
        }
      }
    }
  }
}

function midpointLabel(edge: ComputedEdge): Bounds {
  const segments = edge.points!.slice(1).map((end, index) => ({ start: edge.points![index], end }));
  const { start, end } = segments.toSorted(
    (a, b) => Math.abs(b.end.x - b.start.x) - Math.abs(a.end.x - a.start.x),
  )[0];
  const size = measureEdgeLabel(edge.label!);
  return {
    x: (start.x + end.x - size.width) / 2,
    y: (start.y + end.y - size.height) / 2,
    ...size,
  };
}

describe('custom return corridor simplification', () => {
  for (const example of walkthroughs) {
    for (const spacingCap of [40, 56, example.baseView.layout.spacing!]) {
      it(`shortens the exact ${example.state.id} return at spacing ${spacingCap}`, () => {
        const before = structuredClone(example);
        const layout = stateLayout(example, spacingCap);
        const edge = layout.edges.find(({ id }) => id === example.returnId)!;
        const from = layout.nodes.find(({ id }) => id === edge.from)!;
        const to = layout.nodes.find(({ id }) => id === edge.to)!;
        expect(edge.points!.length).toBeLessThanOrEqual(4);
        expect(Math.min(...edge.points!.map(({ y }) => y))).toBeGreaterThanOrEqual(
          Math.min(from.y, to.y) - 32,
        );
        expect(Math.max(...edge.points!.map(({ y }) => y))).toBeLessThanOrEqual(
          Math.max(from.y + from.height, to.y + to.height) + 32,
        );
        expectClearRoutes(layout);
        const labeledEdges = layout.edges.filter((edge) => edge.label);
        const labels = labeledEdges.map(midpointLabel);
        for (const [index, label] of labels.entries()) {
          const opposite = { x: label.x + label.width, y: label.y + label.height };
          for (const node of layout.nodes) {
            expect(
              enters(label, opposite, node),
              JSON.stringify({ edge: labeledEdges[index], label, node }),
            ).toBe(false);
          }
          for (const other of labels.slice(index + 1)) {
            expect(enters(label, opposite, other)).toBe(false);
          }
          for (const other of layout.edges.filter((edge) => edge !== labeledEdges[index])) {
            other.points!.slice(1).forEach((end, i) => {
              expect(enters(other.points![i], end, label, 2)).toBe(false);
            });
          }
        }
        expect(example).toEqual(before);
        expect(layout.edges.map(({ id }) => id)).toEqual(example.state.visibleEdges);
      });
    }

    it(`keeps renamed and reordered ${example.state.id} routes compact and directed`, () => {
      const renamed = structuredClone(example);
      const names = new Map(renamed.model.nodes.map(({ id }, index) => [id, `node-${9 - index}`]));
      const edgeNames = new Map(
        renamed.model.edges.map(({ id }, index) => [id, `edge-${9 - index}`]),
      );
      renamed.model.nodes = renamed.model.nodes.reverse().map((node, index) => ({
        ...node,
        id: names.get(node.id)!,
        label: `Part ${index}`,
      }));
      renamed.model.edges = renamed.model.edges.reverse().map((edge, index) => ({
        ...edge,
        id: edgeNames.get(edge.id)!,
        from: names.get(edge.from)!,
        to: names.get(edge.to)!,
        label: `Signal ${index}`,
      }));
      renamed.state.visibleNodes = renamed.state.visibleNodes!.map((id) => names.get(id)!);
      renamed.state.visibleEdges = renamed.state.visibleEdges!.map((id) => edgeNames.get(id)!);
      renamed.state.highlightedNodes = renamed.state.highlightedNodes?.map((id) => names.get(id)!);
      if (renamed.state.camera?.focus) {
        renamed.state.camera.focus = names.get(renamed.state.camera.focus)!;
      }
      renamed.returnId = edgeNames.get(renamed.returnId)!;
      const layout = stateLayout(renamed, 56);
      for (const edge of layout.edges) {
        expect(
          edge.points!.length,
          `${edge.id}: ${JSON.stringify(edge.points)}`,
        ).toBeLessThanOrEqual(4);
        const original = renamed.model.edges.find(({ id }) => id === edge.id)!;
        expect(edge).toMatchObject({ from: original.from, to: original.to, label: original.label });
      }
      expectClearRoutes(layout);
    });
  }

  it('uses distinct straight reciprocal lanes when both labels fit between facing ports', () => {
    const model: DiagramModel = {
      nodes: [
        { id: 'a', label: 'A', position: { x: 0, y: 0 }, size: { width: 100, height: 120 } },
        { id: 'b', label: 'B', position: { x: 400, y: 0 }, size: { width: 100, height: 120 } },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b', label: 'request' },
        { id: 'ba', from: 'b', to: 'a', label: 'response', dashed: true },
      ],
    };
    const view: DiagramBaseView = {
      layout: { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' },
    };
    const layout = computeLayout(model, view, 'architecture');
    for (const edge of layout.edges) expect(edge.points).toHaveLength(2);
    expect(layout.edges[1].dashed).toBe(true);
    expectClearRoutes(layout);
    const reversed = computeLayout(
      { ...model, edges: model.edges.toReversed() },
      view,
      'architecture',
    );
    for (const edge of layout.edges) {
      expect(reversed.edges.find(({ id }) => id === edge.id)!.points).toEqual(edge.points);
    }
  });

  it('replaces an obstructed bottom departure without crossing either endpoint body', () => {
    const layout = computeLayout(
      {
        nodes: [
          { id: 'a', label: 'A', position: { x: 0, y: 0 }, size: { width: 140, height: 48 } },
          { id: 'b', label: 'B', position: { x: 300, y: 32 }, size: { width: 140, height: 48 } },
          {
            id: 'block',
            label: 'Block',
            position: { x: 0, y: 64 },
            size: { width: 140, height: 48 },
          },
        ],
        edges: [
          { id: 'out', from: 'a', to: 'b', label: 'starts work' },
          { id: 'back', from: 'b', to: 'a', label: 'returns result' },
        ],
      },
      { layout: { type: 'layered', direction: 'LR', edgeRouting: 'orthogonal' } },
      'architecture',
    );
    // The return fits between facing sides. The outbound route must use the free
    // top ports, not retain a shorter route through the lower sibling or an endpoint.
    expect(layout.edges[1].points).toHaveLength(2);
    expect(layout.edges[0].points).toHaveLength(4);
    expect(Math.min(...layout.edges[0].points!.map(({ y }) => y))).toBeLessThan(0);
    expectClearRoutes(layout);
    for (const edge of layout.edges) {
      const label = midpointLabel(edge);
      const opposite = { x: label.x + label.width, y: label.y + label.height };
      for (const node of layout.nodes) expect(enters(label, opposite, node)).toBe(false);
      for (const other of layout.edges.filter((other) => other !== edge)) {
        other.points!.slice(1).forEach((end, index) => {
          expect(enters(other.points![index], end, label, 2)).toBe(false);
        });
      }
    }
  });

  it('keeps an offset return inside the facing corridor with a horizontal label carrier', () => {
    const model: DiagramModel = {
      nodes: [
        { id: 'a', label: 'A', position: { x: 0, y: 0 }, size: { width: 100, height: 48 } },
        { id: 'b', label: 'B', position: { x: 250, y: 80 }, size: { width: 100, height: 48 } },
      ],
      edges: [{ id: 'back', from: 'b', to: 'a', label: 'Signal 0' }],
    };
    const view: DiagramBaseView = {
      layout: { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' },
    };
    const layout = computeLayout(model, view, 'architecture');
    const [edge] = layout.edges;
    const left = layout.nodes.find(({ id }) => id === 'a')!;
    const right = layout.nodes.find(({ id }) => id === 'b')!;
    const size = measureEdgeLabel(edge.label!);
    const facingGap = right.x - left.x - left.width;
    // Layout may compact authored coordinates; establish the intended gap from its output.
    expect(facingGap).toBeGreaterThanOrEqual(size.width + 16 + 16);
    expect(facingGap).toBeLessThan((size.width + 16) * 2);
    expect(edge.points).toHaveLength(4);
    expect(Math.min(...edge.points!.map(({ y }) => y))).toBeGreaterThanOrEqual(left.y);
    expect(Math.max(...edge.points!.map(({ y }) => y))).toBeLessThanOrEqual(right.y + right.height);
    const horizontalSpan = Math.max(
      ...edge.points!.slice(1).map((end, index) => Math.abs(end.x - edge.points![index].x)),
    );
    expect(horizontalSpan).toBeGreaterThanOrEqual(size.width + 16);
    const label = midpointLabel(edge);
    const opposite = { x: label.x + label.width, y: label.y + label.height };
    for (const node of layout.nodes) expect(enters(label, opposite, node, 8)).toBe(false);
    expectClearRoutes(layout);
    const reordered = computeLayout(
      { ...model, nodes: model.nodes.toReversed() },
      view,
      'architecture',
    );
    expect(reordered.edges[0].points).toEqual(edge.points);
  });

  it('keeps an obstacle detour instead of shortening through a blocked facing corridor', () => {
    const layout = computeLayout(
      {
        nodes: [
          { id: 'a', label: 'A', position: { x: 0, y: 0 }, size: { width: 100, height: 80 } },
          { id: 'b', label: 'B', position: { x: 400, y: 0 }, size: { width: 100, height: 80 } },
          {
            id: 'block',
            label: 'Block',
            position: { x: 200, y: -60 },
            size: { width: 100, height: 200 },
          },
        ],
        edges: [{ id: 'back', from: 'b', to: 'a', label: 'result' }],
      },
      { layout: { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' } },
      'architecture',
    );
    const points = layout.edges[0].points!;
    expect(points.length).toBeGreaterThan(2);
    expectClearRoutes(layout);
    const obstacle = layout.nodes.find(({ id }) => id === 'block')!;
    points.slice(1).forEach((end, index) => {
      expect(enters(points[index], end, obstacle, 8)).toBe(false);
    });
  });

  it('uses two bends when a clear straight shaft cannot accommodate its label', () => {
    const label = 'a longer return label';
    const layout = computeLayout(
      {
        nodes: [
          { id: 'a', label: 'A', position: { x: 0, y: 0 }, size: { width: 100, height: 80 } },
          { id: 'b', label: 'B', position: { x: 160, y: 0 }, size: { width: 100, height: 80 } },
        ],
        edges: [
          { id: 'out', from: 'a', to: 'b', label: 'go' },
          { id: 'back', from: 'b', to: 'a', label },
        ],
      },
      { layout: { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' } },
      'architecture',
    );
    expect(measureEdgeLabel(label).width).toBeGreaterThan(60);
    expect(layout.edges[1].points).toHaveLength(4);
    expectClearRoutes(layout);
  });
});

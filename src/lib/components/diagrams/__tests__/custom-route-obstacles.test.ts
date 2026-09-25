import { describe, expect, it } from 'vitest';

import { createArchitectureDiagram } from '../diagram-templates';
import { CUSTOM_WORKBENCH_CASES } from '../diagram-workbench.preview-fixtures';
import { computeLayout } from '../layout-engine';

type Bounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

function segmentEntersBounds(start: Point, end: Point, bounds: Bounds, clearance: number) {
  const left = bounds.x - clearance;
  const right = bounds.x + bounds.width + clearance;
  const top = bounds.y - clearance;
  const bottom = bounds.y + bounds.height + clearance;
  if (Math.abs(start.x - end.x) < 0.001) {
    return (
      start.x > left &&
      start.x < right &&
      Math.max(start.y, end.y) > top &&
      Math.min(start.y, end.y) < bottom
    );
  }
  return (
    start.y > top &&
    start.y < bottom &&
    Math.max(start.x, end.x) > left &&
    Math.min(start.x, end.x) < right
  );
}

function expectRouteToClear(points: Point[], bounds: Bounds, clearance: number) {
  expect(
    points
      .slice(1)
      .some((point, index) => segmentEntersBounds(points[index], point, bounds, clearance)),
  ).toBe(false);
}

function routesShareSegment(left: Point[], right: Point[]) {
  return left.slice(1).some((leftEnd, leftIndex) =>
    right.slice(1).some((rightEnd, rightIndex) => {
      const leftStart = left[leftIndex];
      const rightStart = right[rightIndex];
      const bothVertical = leftStart.x === leftEnd.x && rightStart.x === rightEnd.x;
      if (bothVertical && leftStart.x === rightStart.x) {
        return (
          Math.min(Math.max(leftStart.y, leftEnd.y), Math.max(rightStart.y, rightEnd.y)) -
            Math.max(Math.min(leftStart.y, leftEnd.y), Math.min(rightStart.y, rightEnd.y)) >
          0.5
        );
      }
      const bothHorizontal = leftStart.y === leftEnd.y && rightStart.y === rightEnd.y;
      return (
        bothHorizontal &&
        leftStart.y === rightStart.y &&
        Math.min(Math.max(leftStart.x, leftEnd.x), Math.max(rightStart.x, rightEnd.x)) -
          Math.max(Math.min(leftStart.x, leftEnd.x), Math.min(rightStart.x, rightEnd.x)) >
          0.5
      );
    }),
  );
}

describe('custom route obstacle avoidance', () => {
  for (const width of [224, 420, 960]) {
    it(`separates mixed backward left ports and lanes at ${width}px`, () => {
      const diagram = CUSTOM_WORKBENCH_CASES['custom-topology-stress'].diagram;
      const layout = computeLayout(
        diagram.model,
        diagram.baseView,
        diagram.grammar,
        undefined,
        width,
      );
      const repair = layout.edges.find(({ id }) => id === 'z3')!;
      const feedback = layout.edges.find(({ id }) => id === 'z11')!;
      const gate = layout.nodes.find(({ id }) => id === 'gate')!;
      expect(repair.points![0].x).toBe(gate.x);
      expect(feedback.points!.at(-1)!.x).toBe(gate.x);
      expect(feedback.points!.at(-1)!.y - repair.points![0].y).toBeGreaterThanOrEqual(12);
      for (const point of [repair.points![0], feedback.points!.at(-1)!]) {
        expect(point.y).toBeGreaterThan(gate.y);
        expect(point.y).toBeLessThan(gate.y + gate.height);
      }
      expect(
        Math.abs(
          Math.min(...repair.points!.map((p) => p.x)) -
            Math.min(...feedback.points!.map((p) => p.x)),
        ),
      ).toBeGreaterThanOrEqual(16);
      expect(routesShareSegment(repair.points!, feedback.points!)).toBe(false);
      for (const edge of [repair, feedback]) {
        for (const node of layout.nodes.filter(
          (node) => node.id !== edge.from && node.id !== edge.to,
        ))
          expectRouteToClear(edge.points!, node, 0);
      }
      expect(
        computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, width),
      ).toEqual(layout);
    });
  }

  it('packs disjoint compact return lanes inside the original exterior envelope', () => {
    const diagram = CUSTOM_WORKBENCH_CASES['custom-topology-stress'].diagram;
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, 224);
    const returns = layout.edges.filter(({ id }) => ['z3', 'z11'].includes(id));
    // The saved pre-fix compact routes share x=-40. Separation must not grow that envelope.
    expect(
      Math.min(...returns.flatMap((edge) => edge.points!.map((point) => point.x))),
    ).toBeGreaterThanOrEqual(-40);
  });

  it('keeps the outer return lane when the inner label corridor is occupied', () => {
    const diagram = structuredClone(CUSTOM_WORKBENCH_CASES['custom-topology-stress'].diagram);
    diagram.model.nodes.forEach((node) => {
      node.size = { width: 150, height: 60 };
    });
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, 224);
    const repair = layout.edges.find(({ id }) => id === 'z3')!;
    const feedback = layout.edges.find(({ id }) => id === 'z11')!;
    expect(Math.min(...feedback.points!.map((point) => point.x))).toBeLessThanOrEqual(
      Math.min(...repair.points!.map((point) => point.x)) - 16,
    );
    for (const node of layout.nodes.filter((node) => !['gate', 'audit'].includes(node.id)))
      expectRouteToClear(feedback.points!, node, 8);
    expect(routesShareSegment(repair.points!, feedback.points!)).toBe(false);
  });

  for (const width of [224, 864]) {
    it(`keeps the authored state-machine branches and return distinct at ${width}px`, () => {
      const diagram = CUSTOM_WORKBENCH_CASES['custom-state-machine'].diagram;
      const layout = computeLayout(
        diagram.model,
        diagram.baseView,
        diagram.grammar,
        undefined,
        width,
      );
      for (const [index, edge] of layout.edges.entries()) {
        for (const other of layout.edges.slice(index + 1)) {
          expect(routesShareSegment(edge.points!, other.points!), `${edge.id}/${other.id}`).toBe(
            false,
          );
        }
        for (const node of layout.nodes.filter(
          (node) => node.id !== edge.from && node.id !== edge.to,
        )) {
          expectRouteToClear(edge.points!, node, 0);
        }
      }
    });
  }

  it('separates overlapping compact return shafts and their final approaches', () => {
    const diagram = CUSTOM_WORKBENCH_CASES['custom-walkthrough'].diagram;
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, 224);
    const left = layout.edges.find((edge) => edge.id === 'w3')!;
    const right = layout.edges.find((edge) => edge.id === 'w5')!;
    expect(routesShareSegment(left.points!, right.points!)).toBe(false);
  });

  it('routes around an unrelated node with visible clearance', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'obstacle', label: 'Unrelated' },
        { id: 'target', label: 'Target' },
      ],
      [{ id: 'route', from: 'source', to: 'target', label: 'request' }],
    );
    diagram.model.nodes[0].position = { x: 0, y: 100 };
    diagram.model.nodes[1].position = { x: 220, y: 100 };
    diagram.model.nodes[2].position = { x: 440, y: 100 };
    diagram.baseView.layout = { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' };

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const obstacle = layout.nodes.find(({ id }) => id === 'obstacle')!;
    const route = layout.edges[0];

    expectRouteToClear(route.points!, obstacle, 8);
    expect(
      route
        .points!.slice(1)
        .every(
          (point, index) =>
            point.x === route.points![index].x || point.y === route.points![index].y,
        ),
    ).toBe(true);
  });

  it('does not use a disconnected group interior as a routing shortcut', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'upper', label: 'Upper', group: 'isolated' },
        { id: 'lower', label: 'Lower', group: 'isolated' },
        { id: 'target', label: 'Target' },
      ],
      [{ id: 'route', from: 'source', to: 'target', label: 'request' }],
    );
    diagram.model.nodes[0].position = { x: 0, y: 120 };
    diagram.model.nodes[1].position = { x: 220, y: 0 };
    diagram.model.nodes[2].position = { x: 220, y: 240 };
    diagram.model.nodes[3].position = { x: 440, y: 120 };
    diagram.model.groups = [{ id: 'isolated', label: 'Disconnected', nodeIds: ['upper', 'lower'] }];
    diagram.baseView.layout = { type: 'manual', direction: 'LR', edgeRouting: 'orthogonal' };

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const group = layout.groups![0];

    expectRouteToClear(layout.edges[0].points!, group, 8);
  });

  it('keeps reciprocal state routes and the dashed return on separate shafts', () => {
    const fixture = CUSTOM_WORKBENCH_CASES['custom-state-machine'];
    if (fixture.kind !== 'custom') throw new Error('Expected a custom diagram fixture');
    const diagram = structuredClone(fixture.diagram);
    diagram.model.edges.push({
      id: 'loading-to-idle',
      from: 'loading',
      to: 'idle',
      label: 'return idle',
    });

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const outbound = layout.edges.find(({ id }) => id === 'st1')!.points!;
    const inbound = layout.edges.find(({ id }) => id === 'loading-to-idle')!.points!;
    const dashedReturn = layout.edges.find(({ id }) => id === 'st4')!.points!;

    expect(outbound[0]).not.toEqual(inbound.at(-1));
    expect(routesShareSegment(outbound, inbound)).toBe(false);
    expect(routesShareSegment(inbound, dashedReturn)).toBe(false);
    expect(routesShareSegment(outbound, dashedReturn)).toBe(false);
  });
});

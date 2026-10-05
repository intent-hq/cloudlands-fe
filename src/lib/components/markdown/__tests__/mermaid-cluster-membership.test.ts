import { afterEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import {
  snapshotFlowchartClusterMembership,
  type FlowchartSubgraphDatabase,
} from '../mermaid-cluster-membership';
import { reserveFlowchartClusterHeaderBands } from '../mermaid-path-geometry';

type Box = { x: number; y: number; width: number; height: number };

class Translation {
  constructor(
    public e = 0,
    public f = 0,
  ) {}
  inverse() {
    return new Translation(-this.e, -this.f);
  }
}

class LayoutPoint {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  matrixTransform(matrix: Translation) {
    return new LayoutPoint(this.x + matrix.e, this.y + matrix.f);
  }
}

function localBox(element: Element): Box {
  if (element.matches('.cluster-label')) return { x: 0, y: 0, width: 380, height: 80 };
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [key, Number(element.getAttribute(key))]),
  ) as Box;
}

function matrix(element: Element | null): Translation {
  const result = new Translation();
  for (let current = element; current; current = current.parentElement) {
    for (const match of (current.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      result.e += Number(match[1]);
      result.f += Number(match[2]);
    }
  }
  return result;
}

function renderedBox(element: Element): Box {
  const local = localBox(element);
  const transform = matrix(element);
  return { ...local, x: local.x + transform.e, y: local.y + transform.f };
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function fixture(names: string[], nested = false) {
  vi.stubGlobal('DOMPoint', LayoutPoint);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-roledescription', 'flowchart-v2');
  const group = (id: string, x: number, y: number, width: number, height: number) =>
    `<g class="cluster" id="render-${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/><g class="cluster-label"/></g>`;
  // The native title-expanded rectangle contains both middle nodes. Only the
  // semantic snapshot distinguishes one member from a legitimate two-member group.
  svg.innerHTML = `<g transform="translate(17, 23)">
    ${group('workers', 0, 80, 460, 140)}
    ${nested ? group('outer', -40, -100, 580, 550) : ''}
    <g class="nodes">${names
      .map(
        (id, index) =>
          `<g class="node" id="render-flowchart-${id}-${index}" transform="translate(${index < 3 ? 80 : 300}, ${(index % 3) * 140})"><rect class="label-container" width="80" height="40"/></g>`,
      )
      .join('')}</g>
    <g class="edgePaths"><path id="render-L_${names[0]}_${names[1]}_0" d="M120,40L120,140" marker-end="url(#arrow)"/></g>
  </g>`;
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    Object.defineProperties(element, {
      getScreenCTM: { value: () => matrix(element) },
      getBBox: { value: () => localBox(element) },
    });
  }
  return svg;
}

afterEach(() => vi.unstubAllGlobals());

describe('semantic cluster framing', () => {
  it.each([
    { name: 'original', names: ['A', 'B', 'C', 'D', 'E', 'F'] },
    {
      name: 'renamed',
      names: ['start-left', 'middle-left', 'end-left', 'start-right', 'middle-right', 'end-right'],
    },
  ])('repairs title-expanded single-member boundaries for $name ids', ({ names }) => {
    const svg = fixture(names);
    const membership = snapshotFlowchartClusterMembership([{ id: 'workers', nodes: [names[1]] }]);
    const before = [...svg.querySelectorAll('g.node > rect')].map(renderedBox);
    reserveFlowchartClusterHeaderBands(svg, membership);
    const frame = renderedBox(svg.querySelector('g.cluster > rect')!);
    const nodes = [...svg.querySelectorAll('g.node > rect')].map(renderedBox);
    expect(nodes[1]).toEqual(before[1]);
    expect(nodes[1].x).toBeGreaterThan(frame.x);
    expect(nodes[1].y).toBeGreaterThan(frame.y + 80);
    expect(nodes[1].x + nodes[1].width).toBeLessThan(frame.x + frame.width);
    expect(nodes[1].y + nodes[1].height).toBeLessThan(frame.y + frame.height);
    for (const [index, node] of nodes.entries()) {
      if (index !== 1) expect(intersects(frame, node), names[index]).toBe(false);
    }
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('marker-end')).toBe('url(#arrow)');
    const first = path.getAttribute('d')!.match(/^M([-\d.]+),([-\d.]+)/)!;
    const transform = matrix(path);
    expect(Number(first[2]) + transform.f).toBe(nodes[0].y + nodes[0].height);
    expect(Number(first[1]) + transform.e).toBe(nodes[0].x + nodes[0].width / 2);
    const last = path.getAttribute('d')!.match(/L([-\d.]+),([-\d.]+)$/)!;
    expect(Number(last[1]) + transform.e).toBe(nodes[1].x + nodes[1].width / 2);
    expect(Number(last[2]) + transform.f).toBe(nodes[1].y);
    expect(svg.querySelectorAll('g.node')).toHaveLength(6);
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    const route = path.getAttribute('d');
    const logicalRoute = path.dataset.manhattanPoints;
    reserveFlowchartClusterHeaderBands(svg, membership);
    expect(renderedBox(svg.querySelector('g.cluster > rect')!)).toEqual(frame);
    expect([...svg.querySelectorAll('g.node > rect')].map(renderedBox)).toEqual(nodes);
    expect(path.getAttribute('d')).toBe(route);
    expect(path.dataset.manhattanPoints).toBe(logicalRoute);
  });

  it('retargets a straight horizontal connector to a moved outsider in path coordinates', () => {
    const svg = fixture(['A', 'B', 'C', 'D', 'E', 'F']);
    const membership = snapshotFlowchartClusterMembership([{ id: 'workers', nodes: ['B'] }]);
    const path = svg.querySelector('path')!;
    path.id = 'render-L_B_E_0';
    // The path has its own coordinate system in addition to the translated graph.
    path.setAttribute('transform', 'translate(5, -7)');
    path.setAttribute('d', 'M155,167L295,167');
    const before = renderedBox(svg.querySelector('#render-flowchart-E-4 > rect')!);
    reserveFlowchartClusterHeaderBands(svg, membership);
    const source = renderedBox(svg.querySelector('#render-flowchart-B-1 > rect')!);
    const target = renderedBox(svg.querySelector('#render-flowchart-E-4 > rect')!);
    expect(target.x).toBeGreaterThan(before.x);
    const points = [...path.getAttribute('d')!.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map(
      (match) => ({ x: Number(match[1]) + matrix(path).e, y: Number(match[2]) + matrix(path).f }),
    );
    expect(points).toEqual([
      { x: source.x + source.width, y: source.y + source.height / 2 },
      { x: target.x, y: target.y + target.height / 2 },
    ]);
    expect(path.getAttribute('marker-end')).toBe('url(#arrow)');
    const route = path.getAttribute('d');
    reserveFlowchartClusterHeaderBands(svg, membership);
    expect(path.getAttribute('d')).toBe(route);
  });

  it('leaves a straight connector unchanged when neither endpoint moves', () => {
    const svg = fixture(['A', 'B', 'C', 'D', 'E', 'F']);
    const membership = snapshotFlowchartClusterMembership([{ id: 'workers', nodes: ['B'] }]);
    const path = svg.querySelector('path')!;
    path.id = 'render-L_B_C_0';
    path.setAttribute('d', 'M120,180L120,280');
    const route = path.getAttribute('d');
    const before = [...svg.querySelectorAll('g.node > rect')].map(renderedBox);
    reserveFlowchartClusterHeaderBands(svg, membership);
    const nodes = [...svg.querySelectorAll('g.node > rect')].map(renderedBox);
    expect(nodes[0]).not.toEqual(before[0]);
    expect(nodes.slice(1, 3)).toEqual(before.slice(1, 3));
    expect(path.getAttribute('d')).toBe(route);
    expect(path.dataset.manhattanPoints).toBeUndefined();
  });

  it('keeps both authored members and encloses a supported nested group', () => {
    const svg = fixture(['A', 'B', 'C', 'D', 'E', 'F'], true);
    const membership = snapshotFlowchartClusterMembership([
      { id: 'outer', nodes: ['workers', 'C'] },
      { id: 'workers', nodes: ['B', 'E'] },
    ]);
    reserveFlowchartClusterHeaderBands(svg, membership);
    const child = renderedBox(svg.querySelector('#render-workers > rect')!);
    const parent = renderedBox(svg.querySelector('#render-outer > rect')!);
    for (const id of ['B', 'E']) {
      const node = renderedBox(svg.querySelector(`[id*="flowchart-${id}-"] > rect`)!);
      expect(node.x).toBeGreaterThan(child.x);
      expect(node.x + node.width).toBeLessThan(child.x + child.width);
      expect(node.y).toBeGreaterThan(child.y + 80);
    }
    expect(child.x).toBeGreaterThanOrEqual(parent.x);
    expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
    expect(child.y).toBeGreaterThan(parent.y + 80);
    expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
    for (const id of ['A', 'D', 'F']) {
      const node = renderedBox(svg.querySelector(`[id*="flowchart-${id}-"] > rect`)!);
      expect(intersects(parent, node)).toBe(false);
    }
  });

  it('copies transitive membership without leaking mutable Mermaid database state', () => {
    const groups = [
      { id: 'inner', nodes: ['member'] },
      { id: 'outer', nodes: ['inner'] },
    ];
    const database: FlowchartSubgraphDatabase = { getSubGraphs: () => groups };
    const first = snapshotFlowchartClusterMembership(database.getSubGraphs());
    groups[0].nodes.splice(0, 1, 'replacement');
    const second = snapshotFlowchartClusterMembership(database.getSubGraphs());
    expect([...first.get('outer')!].sort()).toEqual(['inner', 'member']);
    expect([...second.get('outer')!].sort()).toEqual(['inner', 'replacement']);
    expect(snapshotFlowchartClusterMembership([]).size).toBe(0);
  });

  it('uses Mermaid semantics for external CDN and nested groups, not declaration proximity', async () => {
    mermaid.initialize({ startOnLoad: false });
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(`flowchart LR
      Bucket[Storage]
      subgraph Machine[Runtime]
        subgraph Services[Services]
          Git[Git HTTP]
          Web[Web API]
        end
        LFS[LFS]
        Bundle[Bundles]
      end
      Dev[Developer] --> Machine
      Machine <-->|Logbook| Bucket
      CDN[Static files] -.-> Bucket`);
    const membership = snapshotFlowchartClusterMembership(
      (diagram.db as typeof diagram.db & FlowchartSubgraphDatabase).getSubGraphs(),
    );
    expect([...membership.get('Machine')!].sort()).toEqual([
      'Bundle',
      'Git',
      'LFS',
      'Services',
      'Web',
    ]);
    expect([...membership.get('Services')!].sort()).toEqual(['Git', 'Web']);
    expect([...membership.values()].some((members) => members.has('CDN'))).toBe(false);
  });
});

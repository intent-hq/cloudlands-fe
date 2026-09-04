import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3';
import type { GraphEdge, GraphNode } from './types';

export interface ConstellationLayoutConfig {
  width: number;
  height: number;
  seed?: number;
}

export interface ConstellationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ConstellationLayout {
  update(nodes: GraphNode[], edges: GraphEdge[]): void;
  tick(callback: (nodes: GraphNode[]) => void): () => void;
  pin(id: string, x: number, y: number): void;
  unpin(id: string): void;
  reheat(): void;
  stop(): void;
  fitBounds(): ConstellationBounds;
}

interface LayoutLink extends SimulationLinkDatum<GraphNode> {
  edge: GraphEdge;
  kind: 'task-assignment' | 'delegation' | 'resource';
  count: number;
}

interface Point {
  x: number;
  y: number;
}

const NODE_RADII: Record<GraphNode['type'], number> = {
  agent: 42,
  task: 34,
  file: 24,
  note: 24,
};

const SIMULATION_FIELDS = new Set(['x', 'y', 'vx', 'vy', 'fx', 'fy', 'index']);

function edgeType(edge: GraphEdge): string {
  return String(edge.type);
}

function edgeCount(edge: GraphEdge): number {
  const count = 'count' in edge ? edge.count : 1;
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(1, count) : 1;
}

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SIMULATION_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, semanticValue(child)]),
  );
}

function graphFingerprint(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nodeFingerprint = nodes.map((node) => semanticValue(node));
  const edgeFingerprint = edges.map((edge) => JSON.stringify(semanticValue(edge))).sort();
  return JSON.stringify([nodeFingerprint, edgeFingerprint]);
}

function seededUnit(seed: number, id: string, axis: number): number {
  let hash = (seed ^ (axis * 0x9e3779b9)) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x45d9f3b) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

function jitter(seed: number, id: string): Point {
  return {
    x: (seededUnit(seed, id, 0) - 0.5) * 16,
    y: (seededUnit(seed, id, 1) - 0.5) * 16,
  };
}

function isTopLevelAgent(node: GraphNode): boolean {
  return node.type === 'agent' && (node.isCoordinator || !node.parentAgentId);
}

export function createConstellationLayout({
  width,
  height,
  seed = 1,
}: ConstellationLayoutConfig): ConstellationLayout {
  const center = { x: width / 2, y: height / 2 };
  const ringRadius = Math.max(32, Math.min(width, height) * 0.32);
  const callbacks = new Set<(nodes: GraphNode[]) => void>();
  let currentNodes: GraphNode[] = [];
  let nodeById = new Map<string, GraphNode>();
  let taskAnchors = new Map<string, Point>();
  let fingerprint = '';

  const simulation: Simulation<GraphNode, LayoutLink> = forceSimulation<GraphNode>([])
    .velocityDecay(0.35)
    .alphaDecay(0.035)
    .force('charge', forceManyBody<GraphNode>().strength(-35).distanceMax(360))
    .force(
      'collision',
      forceCollide<GraphNode>((node) => NODE_RADII[node.type] + 6)
        .strength(0.9)
        .iterations(2),
    )
    .on('tick.constellation', () => {
      callbacks.forEach((callback) => callback(currentNodes));
    })
    .stop();

  function computeTaskAnchors(nodes: GraphNode[]): Map<string, Point> {
    const tasks = nodes.filter((node) => node.type === 'task');
    const anchors = new Map<string, Point>();
    tasks.forEach((task, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, tasks.length)) * Math.PI * 2;
      const radius = task.state === 'in_progress' ? ringRadius * 0.62 : ringRadius;
      anchors.set(task.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
    return anchors;
  }

  function anchorIdFor(node: GraphNode, edges: GraphEdge[]): string | undefined {
    if (node.type === 'agent') {
      const assignment = edges.find(
        (edge) => edgeType(edge) === 'task-assignment' && edge.sourceId === node.id,
      );
      const delegation = edges.find(
        (edge) => edgeType(edge) === 'delegation' && edge.targetId === node.id,
      );
      return assignment?.targetId ?? delegation?.sourceId;
    }
    if (node.type === 'task') return undefined;

    const interaction = edges.find(
      (edge) =>
        (edge.targetId === node.id || edge.sourceId === node.id) &&
        (edgeType(edge).startsWith('file-') || edgeType(edge).startsWith('note-')),
    );
    if (!interaction) return undefined;
    return interaction.sourceId === node.id ? interaction.targetId : interaction.sourceId;
  }

  function buildLinks(edges: GraphEdge[]): LayoutLink[] {
    const assignedAgents = new Set(
      edges.filter((edge) => edgeType(edge) === 'task-assignment').map((edge) => edge.sourceId),
    );

    return edges.flatMap((edge): LayoutLink[] => {
      const type = edgeType(edge);
      let kind: LayoutLink['kind'] | undefined;
      if (type === 'task-assignment') kind = 'task-assignment';
      else if (type === 'delegation' && !assignedAgents.has(edge.targetId)) kind = 'delegation';
      else if (type.startsWith('file-') || type.startsWith('note-')) kind = 'resource';
      if (!kind || !nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) return [];

      return [{ source: edge.sourceId, target: edge.targetId, edge, kind, count: edgeCount(edge) }];
    });
  }

  function configureForces(edges: GraphEdge[]): void {
    const links = buildLinks(edges);
    simulation
      .nodes(currentNodes)
      .force(
        'x',
        forceX<GraphNode>((node) =>
          node.type === 'task' ? (taskAnchors.get(node.id)?.x ?? center.x) : center.x,
        ).strength((node) => (node.type === 'task' ? 0.3 : isTopLevelAgent(node) ? 0.18 : 0)),
      )
      .force(
        'y',
        forceY<GraphNode>((node) =>
          node.type === 'task' ? (taskAnchors.get(node.id)?.y ?? center.y) : center.y,
        ).strength((node) => (node.type === 'task' ? 0.3 : isTopLevelAgent(node) ? 0.18 : 0)),
      )
      .force(
        'links',
        forceLink<GraphNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance((link) =>
            link.kind === 'task-assignment' ? 88 : link.kind === 'delegation' ? 104 : 74,
          )
          .strength((link) => {
            if (link.kind === 'task-assignment') return 0.38;
            if (link.kind === 'delegation') return 0.18;
            return Math.min(0.34, 0.07 + Math.log2(link.count + 1) * 0.06);
          }),
      );
  }

  function update(nodes: GraphNode[], edges: GraphEdge[]): void {
    const nextFingerprint = graphFingerprint(nodes, edges);
    if (nextFingerprint === fingerprint) return;

    const previousNodes = nodeById;
    const incomingById = new Map(nodes.map((node) => [node.id, node]));
    taskAnchors = computeTaskAnchors(nodes);
    const nextNodes = nodes.map((incoming) => {
      const existing = previousNodes.get(incoming.id);
      if (!existing) return { ...incoming };

      const physics = {
        x: existing.x,
        y: existing.y,
        vx: existing.vx,
        vy: existing.vy,
        fx: existing.fx,
        fy: existing.fy,
      };
      Object.assign(existing, incoming, physics);
      return existing;
    });
    const nextById = new Map(nextNodes.map((node) => [node.id, node]));

    const positioned = new Set(previousNodes.keys());
    const positioning = new Set<string>();
    const positionNewNode = (node: GraphNode): void => {
      if (positioned.has(node.id)) return;
      if (positioning.has(node.id)) return;
      positioning.add(node.id);

      let anchor = node.type === 'task' ? (taskAnchors.get(node.id) ?? center) : center;
      const sourceNode = incomingById.get(node.id) ?? node;
      const anchorId = anchorIdFor(sourceNode, edges);
      const anchorNode = anchorId ? nextById.get(anchorId) : undefined;
      if (anchorNode) {
        positionNewNode(anchorNode);
        if (positioned.has(anchorNode.id)) anchor = { x: anchorNode.x, y: anchorNode.y };
      }
      const offset = jitter(seed, node.id);
      node.x = node.fx ?? anchor.x + offset.x;
      node.y = node.fy ?? anchor.y + offset.y;
      node.vx = 0;
      node.vy = 0;
      positioning.delete(node.id);
      positioned.add(node.id);
    };
    nextNodes.forEach(positionNewNode);

    currentNodes = nextNodes;
    nodeById = nextById;
    configureForces(edges);
    fingerprint = nextFingerprint;
    simulation.alpha(0.65).restart();
  }

  function reheat(): void {
    simulation.alpha(Math.max(simulation.alpha(), 0.55)).restart();
  }

  return {
    update,
    tick(callback) {
      callbacks.add(callback);
      callback(currentNodes);
      return () => callbacks.delete(callback);
    },
    pin(id, x, y) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
      reheat();
    },
    unpin(id) {
      const node = nodeById.get(id);
      if (!node) return;
      node.fx = null;
      node.fy = null;
      reheat();
    },
    reheat,
    stop() {
      simulation.stop();
    },
    fitBounds() {
      if (currentNodes.length === 0) {
        return {
          minX: center.x,
          minY: center.y,
          maxX: center.x,
          maxY: center.y,
          width: 0,
          height: 0,
        };
      }

      const minX = Math.min(...currentNodes.map((node) => node.x - NODE_RADII[node.type]));
      const minY = Math.min(...currentNodes.map((node) => node.y - NODE_RADII[node.type]));
      const maxX = Math.max(...currentNodes.map((node) => node.x + NODE_RADII[node.type]));
      const maxY = Math.max(...currentNodes.map((node) => node.y + NODE_RADII[node.type]));
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    },
  };
}

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
import { GRAPH_NODE_DIMENSIONS, GRAPH_NODE_GAPS } from './constants';
import type { GraphEdge, GraphNode } from './types';

export interface ConstellationLayoutConfig {
  width: number;
  height: number;
  seed?: number;
}

interface ConstellationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ConstellationLayout {
  update(nodes: GraphNode[], edges: GraphEdge[]): void;
  tick(callback: (nodes: GraphNode[], alpha: number) => void): () => void;
  pin(id: string, x: number, y: number): void;
  unpin(id: string): void;
  reheat(): void;
  settle(): void;
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

const NODE_RADII = Object.fromEntries(
  Object.entries(GRAPH_NODE_DIMENSIONS).map(([type, dimensions]) => [
    type,
    Math.hypot(dimensions.width, dimensions.height) / 2,
  ]),
) as Record<GraphNode['type'], number>;
const TASK_AGENT_DISTANCE = NODE_RADII.task + NODE_RADII.agent + GRAPH_NODE_GAPS.taskAgent + 20;
const RESOURCE_DISTANCE = NODE_RADII.agent + NODE_RADII.file + GRAPH_NODE_GAPS.agentResource + 30;
const AGENT_DISTANCE = NODE_RADII.agent * 2 + GRAPH_NODE_GAPS.taskAgent + 16;
const AGENT_FAN_STEP = 1;
const RESOURCE_FAN_STEP = 0.95;

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
  const callbacks = new Set<(nodes: GraphNode[], alpha: number) => void>();
  let currentNodes: GraphNode[] = [];
  let nodeById = new Map<string, GraphNode>();
  let taskAnchors = new Map<string, Point>();
  let desiredPositions = new Map<string, Point>();
  let fingerprint = '';

  const simulation: Simulation<GraphNode, LayoutLink> = forceSimulation<GraphNode>([])
    .velocityDecay(0.35)
    .alphaDecay(0.035)
    .force('charge', forceManyBody<GraphNode>().strength(-24).distanceMax(420))
    .force(
      'collision',
      forceCollide<GraphNode>((node) => NODE_RADII[node.type] + GRAPH_NODE_GAPS.collision)
        .strength(1)
        .iterations(4),
    )
    .on('tick.constellation', () => {
      callbacks.forEach((callback) => callback(currentNodes, simulation.alpha()));
    })
    .stop();

  function computeTaskAnchors(nodes: GraphNode[]): Map<string, Point> {
    const tasks = nodes.filter((node) => node.type === 'task');
    const topLevelCount = nodes.filter(isTopLevelAgent).length;
    const centerOrbit =
      topLevelCount > 1 ? AGENT_DISTANCE / (2 * Math.sin(Math.PI / topLevelCount)) : 0;
    const centerClearance =
      topLevelCount > 0
        ? centerOrbit + NODE_RADII.agent + NODE_RADII.task + GRAPH_NODE_GAPS.taskAgent
        : 0;
    const clusterSpacing = NODE_RADII.task * 2 + NODE_RADII.agent + GRAPH_NODE_GAPS.taskAgent;
    const taskSpacingRadius =
      tasks.length > 1 ? clusterSpacing / (2 * Math.sin(Math.PI / tasks.length)) : 0;
    const ringRadius = Math.max(Math.min(width, height) * 0.32, centerClearance, taskSpacingRadius);
    const anchors = new Map<string, Point>();
    tasks.forEach((task, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, tasks.length)) * Math.PI * 2;
      anchors.set(task.id, {
        x: center.x + Math.cos(angle) * ringRadius,
        y: center.y + Math.sin(angle) * ringRadius,
      });
    });
    return anchors;
  }

  function angleFromCenter(point: Point, fallbackId: string): number {
    if (point.x !== center.x || point.y !== center.y) {
      return Math.atan2(point.y - center.y, point.x - center.x);
    }
    return seededUnit(seed, fallbackId, 2) * Math.PI * 2;
  }

  function topLevelResourceAngles(): number[] {
    const angles = [...taskAnchors.values()]
      .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
      .sort((a, b) => a - b);
    if (angles.length === 0) return [];
    return angles.map((angle, index) => {
      const next =
        angles[(index + 1) % angles.length] + (index === angles.length - 1 ? Math.PI * 2 : 0);
      return angle + (next - angle) / 2;
    });
  }

  function computeDesiredPositions(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
    const positions = new Map(taskAnchors);
    const orderedIds = new Map(nodes.map((node, index) => [node.id, index]));
    const topLevelAgents = nodes.filter(isTopLevelAgent);
    const topLevelRadius =
      topLevelAgents.length > 1
        ? AGENT_DISTANCE / (2 * Math.sin(Math.PI / topLevelAgents.length))
        : 0;
    topLevelAgents.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, topLevelAgents.length)) * Math.PI * 2;
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * topLevelRadius,
        y: center.y + Math.sin(angle) * topLevelRadius,
      });
    });

    const assignments = edges.filter((edge) => edgeType(edge) === 'task-assignment');
    for (const task of nodes.filter((node) => node.type === 'task')) {
      const taskPosition = taskAnchors.get(task.id);
      if (!taskPosition) continue;
      const assigned = assignments
        .filter(
          (edge) => edge.targetId === task.id && nodeById.get(edge.sourceId)?.type === 'agent',
        )
        .sort((a, b) => (orderedIds.get(a.sourceId) ?? 0) - (orderedIds.get(b.sourceId) ?? 0));
      const baseAngle = angleFromCenter(taskPosition, task.id);
      assigned.forEach((edge, index) => {
        const angle = baseAngle + (index - (assigned.length - 1) / 2) * AGENT_FAN_STEP;
        positions.set(edge.sourceId, {
          x: taskPosition.x + Math.cos(angle) * TASK_AGENT_DISTANCE,
          y: taskPosition.y + Math.sin(angle) * TASK_AGENT_DISTANCE,
        });
      });
    }

    const assignedAgents = new Set(assignments.map((edge) => edge.sourceId));
    const delegations = edges.filter(
      (edge) => edgeType(edge) === 'delegation' && !assignedAgents.has(edge.targetId),
    );
    const placeDelegatedAgent = (id: string, visiting = new Set<string>()): Point => {
      const existing = positions.get(id);
      if (existing) return existing;
      if (visiting.has(id)) return center;
      visiting.add(id);
      const delegation = delegations.find((edge) => edge.targetId === id);
      const parent = delegation ? placeDelegatedAgent(delegation.sourceId, visiting) : center;
      const siblings = delegation
        ? delegations.filter((edge) => edge.sourceId === delegation.sourceId)
        : [];
      const siblingIndex = delegation ? siblings.indexOf(delegation) : 0;
      const baseAngle = angleFromCenter(parent, id);
      const angle = baseAngle + (siblingIndex - (siblings.length - 1) / 2) * AGENT_FAN_STEP;
      const position = {
        x: parent.x + Math.cos(angle) * AGENT_DISTANCE,
        y: parent.y + Math.sin(angle) * AGENT_DISTANCE,
      };
      positions.set(id, position);
      return position;
    };
    nodes
      .filter(
        (node) => node.type === 'agent' && !isTopLevelAgent(node) && !assignedAgents.has(node.id),
      )
      .forEach((node) => placeDelegatedAgent(node.id));

    const safeTopLevelAngles = topLevelResourceAngles();
    const resourceEdges = edges.filter(
      (edge) => edgeType(edge).startsWith('file-') || edgeType(edge).startsWith('note-'),
    );
    for (const owner of nodes.filter((node) => node.type === 'agent')) {
      const ownerPosition = positions.get(owner.id) ?? center;
      const resources = resourceEdges
        .filter((edge) => edge.sourceId === owner.id)
        .filter(
          (edge, index, all) =>
            all.findIndex(({ targetId }) => targetId === edge.targetId) === index,
        )
        .sort((a, b) => (orderedIds.get(a.targetId) ?? 0) - (orderedIds.get(b.targetId) ?? 0));
      const baseAngle = angleFromCenter(ownerPosition, owner.id);
      resources.forEach((edge, index) => {
        const angle =
          isTopLevelAgent(owner) && safeTopLevelAngles.length > 0
            ? safeTopLevelAngles[index % safeTopLevelAngles.length]
            : baseAngle + (index - (resources.length - 1) / 2) * RESOURCE_FAN_STEP;
        positions.set(edge.targetId, {
          x: ownerPosition.x + Math.cos(angle) * RESOURCE_DISTANCE,
          y: ownerPosition.y + Math.sin(angle) * RESOURCE_DISTANCE,
        });
      });
    }
    return positions;
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
    desiredPositions = computeDesiredPositions(currentNodes, edges);
    simulation
      .nodes(currentNodes)
      .force(
        'x',
        forceX<GraphNode>((node) => desiredPositions.get(node.id)?.x ?? center.x).strength(
          (node) =>
            node.type === 'task' || isTopLevelAgent(node)
              ? 0.5
              : node.type === 'agent'
                ? 0.22
                : 0.16,
        ),
      )
      .force(
        'y',
        forceY<GraphNode>((node) => desiredPositions.get(node.id)?.y ?? center.y).strength(
          (node) =>
            node.type === 'task' || isTopLevelAgent(node)
              ? 0.5
              : node.type === 'agent'
                ? 0.22
                : 0.16,
        ),
      )
      .force(
        'links',
        forceLink<GraphNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance((link) =>
            link.kind === 'task-assignment'
              ? TASK_AGENT_DISTANCE
              : link.kind === 'delegation'
                ? AGENT_DISTANCE
                : RESOURCE_DISTANCE,
          )
          .strength((link) => {
            if (link.kind === 'task-assignment') return 0.5;
            if (link.kind === 'delegation') return 0.32;
            return Math.min(0.5, 0.28 + Math.log2(link.count + 1) * 0.05);
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
      const desired = desiredPositions.get(node.id);
      node.x = node.fx ?? desired?.x ?? anchor.x + offset.x;
      node.y = node.fy ?? desired?.y ?? anchor.y + offset.y;
      node.vx = 0;
      node.vy = 0;
      positioning.delete(node.id);
      positioned.add(node.id);
    };
    currentNodes = nextNodes;
    nodeById = nextById;
    configureForces(edges);
    nextNodes.forEach(positionNewNode);
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
      callback(currentNodes, simulation.alpha());
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
    settle() {
      simulation.stop();
      for (let index = 0; index < 300 && simulation.alpha() >= 0.001; index += 1) {
        simulation.tick();
      }
      callbacks.forEach((callback) => callback(currentNodes, simulation.alpha()));
    },
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

      const minX = Math.min(
        ...currentNodes.map((node) => node.x - GRAPH_NODE_DIMENSIONS[node.type].width / 2),
      );
      const minY = Math.min(
        ...currentNodes.map((node) => node.y - GRAPH_NODE_DIMENSIONS[node.type].height / 2),
      );
      const maxX = Math.max(
        ...currentNodes.map((node) => node.x + GRAPH_NODE_DIMENSIONS[node.type].width / 2),
      );
      const maxY = Math.max(
        ...currentNodes.map((node) => node.y + GRAPH_NODE_DIMENSIONS[node.type].height / 2),
      );
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    },
  };
}

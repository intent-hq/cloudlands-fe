import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3';
import { GRAPH_NODE_DIMENSIONS, GRAPH_NODE_GAPS } from './constants';
import { anchorFitBounds, NODE_SCREEN_MARGINS } from './graph-fit';
import type { GraphEdge, GraphNode } from './types';

export interface ConstellationLayoutConfig {
  width: number;
  height: number;
  fitTarget?: { width: number; height: number };
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
  resize(config: Pick<ConstellationLayoutConfig, 'width' | 'height' | 'fitTarget'>): void;
  settle(): void;
  stop(): void;
  fitBounds(candidateScale?: number): ConstellationBounds;
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
const AGENT_AXIS_OFFSET = Math.PI / 10;
const RESOURCE_FAN_STEP = 0.95;
const SINGLE_RING_TASK_LIMIT = 8;
const TASK_RING_STEP_RATIO = 0.92;
const TASK_ANCHOR_SPACING_RATIO = 0.9;
const TASK_ORBIT_WIDTH_RATIO = 0.36;
const TASK_ORBIT_HEIGHT_RATIO = 0.32;
const TASK_ORBIT_MIN_ASPECT = 0.7;
export const SMALL_GRAPH_FIT_SCALE = 0.7;
/** Smallest visible separation retained while compacting small graphs, in screen pixels. */
export const MIN_COMPACT_NODE_GAP = 8;
const MIN_COMPACT_TASK_AGENT_DISTANCE = 106;
const MIN_COMPACT_RESOURCE_DISTANCE = 104;
const MIN_COMPACT_AGENT_DISTANCE = 112;
const MIN_COMPACT_ORBIT_Y = 48;
const COMPACT_SCREEN_MARGINS_Y = 80;
const COMPACT_LAYOUT_SLACK = 16;
const SIMULATION_VELOCITY_DECAY = 0.35;

interface CollisionEnvelope {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
}

const COMPACT_NODE_DIMENSIONS: Record<GraphNode['type'], CollisionEnvelope> = {
  agent: { width: 128 / SMALL_GRAPH_FIT_SCALE, height: 90 },
  task: { width: GRAPH_NODE_DIMENSIONS.task.width, height: 56, offsetY: 4 },
  file: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 96, offsetY: 4 },
  note: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 96, offsetY: 4 },
};
const COMPACT_LABEL_DIMENSIONS: Record<GraphNode['type'], CollisionEnvelope> = {
  agent: { width: 128 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, offsetY: 20 },
  task: { width: GRAPH_NODE_DIMENSIONS.task.width, height: 56, offsetY: 4 },
  file: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, offsetY: 31 },
  note: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, offsetY: 31 },
};
function rectangleCollisionForce(
  dimensions: Record<GraphNode['type'], CollisionEnvelope>,
  gap: number,
): Force<GraphNode, undefined> {
  let nodes: GraphNode[] = [];
  const force = (() => {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      const leftSize = dimensions[left.type];
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        const rightSize = dimensions[right.type];
        const dx =
          right.x +
          right.vx +
          (rightSize.offsetX ?? 0) -
          left.x -
          left.vx -
          (leftSize.offsetX ?? 0);
        const dy =
          right.y +
          right.vy +
          (rightSize.offsetY ?? 0) -
          left.y -
          left.vy -
          (leftSize.offsetY ?? 0);
        const overlapX = (leftSize.width + rightSize.width) / 2 + gap - Math.abs(dx);
        const overlapY = (leftSize.height + rightSize.height) / 2 + gap - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const shift = overlapX * 0.8 * (dx < 0 ? -1 : 1);
          left.vx -= shift;
          right.vx += shift;
        } else {
          const shift = overlapY * 0.8 * (dy < 0 ? -1 : 1);
          left.vy -= shift;
          right.vy += shift;
        }
      }
    }
  }) as Force<GraphNode, undefined>;
  force.initialize = (nextNodes) => (nodes = nextNodes);
  return force;
}

function compactBoundaryForce(
  target: { width: number; height: number },
  center: Point,
): Force<GraphNode, undefined> {
  let nodes: GraphNode[] = [];
  const force = (() => {
    for (const node of nodes) {
      const margin = NODE_SCREEN_MARGINS[node.type];
      const minX = center.x - target.width / 2 + margin.left / SMALL_GRAPH_FIT_SCALE;
      const maxX = center.x + target.width / 2 - margin.right / SMALL_GRAPH_FIT_SCALE;
      const minY = center.y - target.height / 2 + margin.top / SMALL_GRAPH_FIT_SCALE;
      const maxY = center.y + target.height / 2 - margin.bottom / SMALL_GRAPH_FIT_SCALE;
      const nextX = node.x + node.vx;
      const nextY = node.y + node.vy;
      const velocityRetention = 1 - SIMULATION_VELOCITY_DECAY;
      if (nextX < minX) node.vx += (minX - nextX) / velocityRetention;
      else if (nextX > maxX) node.vx += (maxX - nextX) / velocityRetention;
      if (nextY < minY) node.vy += (minY - nextY) / velocityRetention;
      else if (nextY > maxY) node.vy += (maxY - nextY) / velocityRetention;
    }
  }) as Force<GraphNode, undefined>;
  force.initialize = (nextNodes) => (nodes = nextNodes);
  return force;
}

function edgeType(edge: GraphEdge): string {
  return String(edge.type);
}

function edgeCount(edge: GraphEdge): number {
  const count = 'count' in edge ? edge.count : 1;
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(1, count) : 1;
}

function structuralNodeValue(node: GraphNode): unknown {
  if (node.type === 'agent') {
    return [
      node.id,
      node.type,
      node.parentAgentId,
      node.taskNoteId,
      node.isCoordinator,
      node.isBackground,
    ];
  }
  if (node.type === 'task') return [node.id, node.type, node.dependsOn];
  return [node.id, node.type];
}

function graphFingerprint(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nodeFingerprint = nodes.map(structuralNodeValue);
  const edgeFingerprint = edges
    .map((edge) => JSON.stringify([edge.sourceId, edge.targetId, edge.type]))
    .sort();
  return JSON.stringify([nodeFingerprint, edgeFingerprint]);
}

function linkStrengthFingerprint(edges: GraphEdge[]): string {
  return JSON.stringify(
    edges
      .filter((edge) => edgeType(edge).startsWith('file-') || edgeType(edge).startsWith('note-'))
      .map((edge) => JSON.stringify([edge.sourceId, edge.targetId, edge.type, edgeCount(edge)]))
      .sort(),
  );
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
  fitTarget,
  seed = 1,
}: ConstellationLayoutConfig): ConstellationLayout {
  let viewport: Pick<ConstellationLayoutConfig, 'width' | 'height' | 'fitTarget'> = {
    width,
    height,
    fitTarget,
  };
  let center = { x: width / 2, y: height / 2 };
  const callbacks = new Set<(nodes: GraphNode[], alpha: number) => void>();
  let currentNodes: GraphNode[] = [];
  let nodeById = new Map<string, GraphNode>();
  let taskAnchors = new Map<string, Point>();
  let desiredPositions = new Map<string, Point>();
  let currentEdges: GraphEdge[] = [];
  let fingerprint = '';
  let strengthFingerprint = '';

  const simulation: Simulation<GraphNode, LayoutLink> = forceSimulation<GraphNode>([])
    .velocityDecay(SIMULATION_VELOCITY_DECAY)
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

  function compactGeometry(nodeCount: number): {
    taskAgentDistance: number;
    resourceDistance: number;
    agentDistance: number;
    orbitX: number;
    orbitY: number;
    compact: boolean;
  } {
    const compact = nodeCount <= 40 && viewport.fitTarget !== undefined;
    if (!compact) {
      const orbitX = viewport.width * TASK_ORBIT_WIDTH_RATIO;
      return {
        taskAgentDistance: TASK_AGENT_DISTANCE,
        resourceDistance: RESOURCE_DISTANCE,
        agentDistance: AGENT_DISTANCE,
        orbitX,
        orbitY: Math.max(viewport.height * TASK_ORBIT_HEIGHT_RATIO, orbitX * TASK_ORBIT_MIN_ASPECT),
        compact,
      };
    }
    const target = viewport.fitTarget!;
    const nestedBudget = Math.max(
      MIN_COMPACT_TASK_AGENT_DISTANCE + MIN_COMPACT_RESOURCE_DISTANCE,
      target.height / 2 - MIN_COMPACT_ORBIT_Y - COMPACT_SCREEN_MARGINS_Y - COMPACT_LAYOUT_SLACK,
    );
    const taskAgentDistance = Math.max(
      MIN_COMPACT_TASK_AGENT_DISTANCE,
      nestedBudget * (TASK_AGENT_DISTANCE / (TASK_AGENT_DISTANCE + RESOURCE_DISTANCE)),
    );
    const resourceDistance = Math.max(
      MIN_COMPACT_RESOURCE_DISTANCE,
      nestedBudget - taskAgentDistance,
    );
    const orbitX = Math.min(
      viewport.width * TASK_ORBIT_WIDTH_RATIO,
      Math.max(MIN_COMPACT_ORBIT_Y, target.width / 2 - taskAgentDistance - resourceDistance - 96),
    );
    const orbitY = Math.min(
      Math.max(
        viewport.height * TASK_ORBIT_HEIGHT_RATIO,
        viewport.width * TASK_ORBIT_WIDTH_RATIO * TASK_ORBIT_MIN_ASPECT,
      ),
      Math.max(
        MIN_COMPACT_ORBIT_Y,
        target.height / 2 -
          taskAgentDistance -
          resourceDistance -
          COMPACT_SCREEN_MARGINS_Y -
          COMPACT_LAYOUT_SLACK,
      ),
    );
    return {
      taskAgentDistance,
      resourceDistance,
      agentDistance: Math.max(MIN_COMPACT_AGENT_DISTANCE, taskAgentDistance),
      orbitX,
      orbitY,
      compact,
    };
  }

  function ringCapacity(radius: number, minimumSpacing: number): number {
    return Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, minimumSpacing / (2 * radius)))));
  }

  function balancedSlotOrder(capacity: number): number[] {
    const slots = [0];
    while (slots.length < capacity) {
      let bestSlot = 0;
      let bestDistance = -1;
      for (let candidate = 1; candidate < capacity; candidate += 1) {
        if (slots.includes(candidate)) continue;
        const distance = Math.min(
          ...slots.map((slot) => {
            const gap = Math.abs(candidate - slot);
            return Math.min(gap, capacity - gap);
          }),
        );
        if (distance > bestDistance) {
          bestSlot = candidate;
          bestDistance = distance;
        }
      }
      slots.push(bestSlot);
    }
    return slots;
  }

  function computeTaskAnchors(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
    const tasks = nodes.filter((node) => node.type === 'task');
    const clusterSpacing = NODE_RADII.task * 2 + NODE_RADII.agent + GRAPH_NODE_GAPS.taskAgent;
    const { orbitX, orbitY } = compactGeometry(nodes.length);
    const anchors = new Map<string, Point>();
    if (tasks.length <= SINGLE_RING_TASK_LIMIT) {
      tasks.forEach((task, index) => {
        const angle = -Math.PI / 2 + (index / Math.max(1, tasks.length)) * Math.PI * 2;
        anchors.set(task.id, {
          x: center.x + Math.cos(angle) * orbitX,
          y: center.y + Math.sin(angle) * orbitY,
        });
      });
      return anchors;
    }

    const resourceOwnerIds = new Set(
      edges
        .filter((edge) => edgeType(edge).startsWith('file-') || edgeType(edge).startsWith('note-'))
        .map((edge) => edge.sourceId),
    );
    const taskPriority = new Map<string, number>();
    for (const edge of edges.filter((edge) => edgeType(edge) === 'task-assignment')) {
      taskPriority.set(
        edge.targetId,
        Math.max(taskPriority.get(edge.targetId) ?? 0, resourceOwnerIds.has(edge.sourceId) ? 2 : 1),
      );
    }
    // Source order is stable within each attachment tier; new bare tasks therefore append without
    // moving existing anchors, while task clusters with agents/resources occupy inner rings first.
    const orderedTasks = tasks
      .map((task, index) => ({ task, index, priority: taskPriority.get(task.id) ?? 0 }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .map(({ task }) => task);
    const minimumSpacing = clusterSpacing * TASK_ANCHOR_SPACING_RATIO;
    const ringStep = clusterSpacing * TASK_RING_STEP_RATIO;
    let taskIndex = 0;
    for (let ringIndex = 0; taskIndex < orderedTasks.length; ringIndex += 1) {
      const radiusX = orbitX + ringIndex * ringStep;
      const radiusY = orbitY + ringIndex * ringStep;
      const capacity = ringCapacity(Math.min(radiusX, radiusY), minimumSpacing);
      const slotOrder = balancedSlotOrder(capacity);
      for (let index = 0; index < capacity && taskIndex < orderedTasks.length; index += 1) {
        const task = orderedTasks[taskIndex++];
        const angle = -Math.PI / 2 + (slotOrder[index] / capacity) * Math.PI * 2;
        anchors.set(task.id, {
          x: center.x + Math.cos(angle) * radiusX,
          y: center.y + Math.sin(angle) * radiusY,
        });
      }
    }
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
    const { taskAgentDistance, resourceDistance, agentDistance } = compactGeometry(nodes.length);
    const orderedIds = new Map(nodes.map((node, index) => [node.id, index]));
    const topLevelAgents = nodes.filter(isTopLevelAgent);
    const topLevelRadius =
      topLevelAgents.length > 1
        ? agentDistance / (2 * Math.sin(Math.PI / topLevelAgents.length))
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
        const fanOffset = (index - (assigned.length - 1) / 2) * AGENT_FAN_STEP;
        const axisOffset =
          fanOffset === 0 ? AGENT_AXIS_OFFSET : Math.sign(fanOffset) * AGENT_AXIS_OFFSET;
        const angle = baseAngle + fanOffset + axisOffset;
        positions.set(edge.sourceId, {
          x: taskPosition.x + Math.cos(angle) * taskAgentDistance,
          y: taskPosition.y + Math.sin(angle) * taskAgentDistance,
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
        x: parent.x + Math.cos(angle) * agentDistance,
        y: parent.y + Math.sin(angle) * agentDistance,
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
          x: ownerPosition.x + Math.cos(angle) * resourceDistance,
          y: ownerPosition.y + Math.sin(angle) * resourceDistance,
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

  function configureLinkForce(edges: GraphEdge[]): void {
    const { taskAgentDistance, resourceDistance, agentDistance } = compactGeometry(
      currentNodes.length,
    );
    simulation.force(
      'links',
      forceLink<GraphNode, LayoutLink>(buildLinks(edges))
        .id((node) => node.id)
        .distance((link) =>
          link.kind === 'task-assignment'
            ? taskAgentDistance
            : link.kind === 'delegation'
              ? agentDistance
              : resourceDistance,
        )
        .strength((link) => {
          if (link.kind === 'task-assignment') return 0.5;
          if (link.kind === 'delegation') return 0.32;
          return Math.min(0.5, 0.28 + Math.log2(link.count + 1) * 0.05);
        }),
    );
  }

  function configureForces(edges: GraphEdge[]): void {
    const { compact } = compactGeometry(currentNodes.length);
    desiredPositions = computeDesiredPositions(currentNodes, edges);
    simulation
      .nodes(currentNodes)
      .force(
        'collision',
        compact
          ? rectangleCollisionForce(
              COMPACT_NODE_DIMENSIONS,
              (MIN_COMPACT_NODE_GAP + 1) / SMALL_GRAPH_FIT_SCALE,
            )
          : forceCollide<GraphNode>((node) => NODE_RADII[node.type] + GRAPH_NODE_GAPS.collision)
              .strength(1)
              .iterations(4),
      )
      .force(
        'label-collision',
        compact
          ? rectangleCollisionForce(
              COMPACT_LABEL_DIMENSIONS,
              (MIN_COMPACT_NODE_GAP + 1) / SMALL_GRAPH_FIT_SCALE,
            )
          : null,
      )
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
      );
    simulation.force(
      'compact-boundary',
      compact && viewport.fitTarget ? compactBoundaryForce(viewport.fitTarget, center) : null,
    );
    configureLinkForce(edges);
  }

  function update(nodes: GraphNode[], edges: GraphEdge[]): void {
    currentEdges = edges;
    const nextFingerprint = graphFingerprint(nodes, edges);
    const nextStrengthFingerprint = linkStrengthFingerprint(edges);
    if (nextFingerprint === fingerprint) {
      if (nextStrengthFingerprint !== strengthFingerprint) {
        configureLinkForce(edges);
        strengthFingerprint = nextStrengthFingerprint;
      }
      return;
    }

    const previousNodes = nodeById;
    const incomingById = new Map(nodes.map((node) => [node.id, node]));
    taskAnchors = computeTaskAnchors(nodes, edges);
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
    strengthFingerprint = nextStrengthFingerprint;
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
    resize(next) {
      if (
        next.width === viewport.width &&
        next.height === viewport.height &&
        next.fitTarget?.width === viewport.fitTarget?.width &&
        next.fitTarget?.height === viewport.fitTarget?.height
      ) {
        return;
      }
      viewport = next;
      center = { x: next.width / 2, y: next.height / 2 };
      taskAnchors = computeTaskAnchors(currentNodes, currentEdges);
      configureForces(currentEdges);
      reheat();
    },
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
    fitBounds(candidateScale = 1) {
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

      return anchorFitBounds(
        currentNodes,
        new Map(currentNodes.map((node) => [node.id, node])),
        candidateScale,
      );
    },
  };
}

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
import {
  anchorFitBounds,
  NODE_SCREEN_MARGINS,
  SMALL_GRAPH_FIT_FLOOR,
  smallGraphNeedsFitFallback,
} from './graph-fit';
import { paddedHull, taskHullPadding, type HullPoint } from './hull-geometry';
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

interface TaskCluster {
  taskId: string;
  agentIds: string[];
  satelliteIds: string[];
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
const AGENT_FAN_STEP = Math.PI / 6;
const AGENT_AXIS_OFFSET = Math.PI / 12;
const RESOURCE_FAN_STEP = 0.95;
const TOP_LEVEL_RESOURCE_FAN_STEP = 0.6;
const TASK_ADJACENCY_EDGE_TYPES = new Set(['delegation', 'message', 'waiting-on']);
const SINGLE_RING_TASK_LIMIT = 8;
const TASK_RING_STEP_RATIO = 1.01;
const TASK_ANCHOR_SPACING_RATIO = 1;
const TASK_ORBIT_WIDTH_RATIO = 0.36;
const TASK_ORBIT_HEIGHT_RATIO = 0.32;
const TASK_ORBIT_MIN_ASPECT = 0.7;
const HULL_SEPARATION_GAP = 48;
export const SMALL_GRAPH_FIT_SCALE = 0.7;
/** Smallest visible separation retained while compacting small graphs, in screen pixels. */
export const MIN_COMPACT_NODE_GAP = 8;
const MIN_COMPACT_TASK_AGENT_DISTANCE = 96;
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

function compactNodeDimensions(scale: number): Record<GraphNode['type'], CollisionEnvelope> {
  const dimensions = Object.fromEntries(
    Object.entries(NODE_SCREEN_MARGINS).map(([type, margin]) => [
      type,
      {
        width: (margin.left + margin.right) / scale,
        height: (margin.top + margin.bottom) / scale,
        offsetX: (margin.right - margin.left) / (2 * scale),
        offsetY: (margin.bottom - margin.top) / (2 * scale),
      },
    ]),
  ) as Record<GraphNode['type'], CollisionEnvelope>;
  dimensions.task = {
    width: GRAPH_NODE_DIMENSIONS.task.width,
    height: GRAPH_NODE_DIMENSIONS.task.height,
  };
  return dimensions;
}
function rectangleCollisionForce(
  dimensions: Record<GraphNode['type'], CollisionEnvelope>,
  gap: number,
  boundary?: { target: { width: number; height: number }; center: Point; scale: number },
): Force<GraphNode, undefined> {
  let nodes: GraphNode[] = [];
  const force = (() => {
    const velocityRetention = 1 - SIMULATION_VELOCITY_DECAY;
    const targetWidth = boundary
      ? (boundary.target.width * SMALL_GRAPH_FIT_SCALE) / boundary.scale
      : 0;
    const targetHeight = boundary
      ? (boundary.target.height * SMALL_GRAPH_FIT_SCALE) / boundary.scale
      : 0;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      if (boundary) {
        for (const node of nodes) {
          const margin = NODE_SCREEN_MARGINS[node.type];
          const minX = boundary.center.x - targetWidth / 2 + margin.left / boundary.scale;
          const maxX = boundary.center.x + targetWidth / 2 - margin.right / boundary.scale;
          const minY = boundary.center.y - targetHeight / 2 + margin.top / boundary.scale;
          const maxY = boundary.center.y + targetHeight / 2 - margin.bottom / boundary.scale;
          const nextX = node.x + node.vx * velocityRetention;
          const nextY = node.y + node.vy * velocityRetention;
          if (nextX < minX) node.vx += (minX - nextX) / velocityRetention;
          else if (nextX > maxX) node.vx += (maxX - nextX) / velocityRetention;
          if (nextY < minY) node.vy += (minY - nextY) / velocityRetention;
          else if (nextY > maxY) node.vy += (maxY - nextY) / velocityRetention;
        }
      }
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        const leftSize = dimensions[left.type];
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const right = nodes[rightIndex];
          const rightSize = dimensions[right.type];
          const dx =
            right.x +
            right.vx * velocityRetention +
            (rightSize.offsetX ?? 0) -
            left.x -
            left.vx * velocityRetention -
            (leftSize.offsetX ?? 0);
          const dy =
            right.y +
            right.vy * velocityRetention +
            (rightSize.offsetY ?? 0) -
            left.y -
            left.vy * velocityRetention -
            (leftSize.offsetY ?? 0);
          const overlapX = (leftSize.width + rightSize.width) / 2 + gap - Math.abs(dx);
          const overlapY = (leftSize.height + rightSize.height) / 2 + gap - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (overlapX < overlapY) {
            const shift = (overlapX / (4 * velocityRetention)) * (dx < 0 ? -1 : 1);
            left.vx -= shift;
            right.vx += shift;
          } else {
            const shift = (overlapY / (4 * velocityRetention)) * (dy < 0 ? -1 : 1);
            left.vy -= shift;
            right.vy += shift;
          }
        }
      }
    }
  }) as Force<GraphNode, undefined>;
  force.initialize = (nextNodes) => (nodes = nextNodes);
  return force;
}

function compactFitScale(nodes: GraphNode[], target: { width: number; height: number }): number {
  return smallGraphNeedsFitFallback(
    nodes,
    target.width * SMALL_GRAPH_FIT_SCALE,
    target.height * SMALL_GRAPH_FIT_SCALE,
    MIN_COMPACT_NODE_GAP,
  )
    ? SMALL_GRAPH_FIT_FLOOR
    : SMALL_GRAPH_FIT_SCALE;
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
  let taskClusters: TaskCluster[] = [];
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
    if (!compact || !viewport.fitTarget) {
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
    const fitTarget = viewport.fitTarget;
    const scale = compactFitScale(currentNodes, fitTarget);
    const target = {
      width: (fitTarget.width * SMALL_GRAPH_FIT_SCALE) / scale,
      height: (fitTarget.height * SMALL_GRAPH_FIT_SCALE) / scale,
    };
    const taskAgentDistance = MIN_COMPACT_TASK_AGENT_DISTANCE;
    const resourceDistance = RESOURCE_DISTANCE;
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
      agentDistance: MIN_COMPACT_AGENT_DISTANCE,
      orbitX,
      orbitY,
      compact,
    };
  }

  function ringCapacity(radius: number, minimumSpacing: number): number {
    if (minimumSpacing > radius * 2) return 1;
    return Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, minimumSpacing / (2 * radius)))));
  }

  function taskClusterAgentIds(taskId: string, nodes: GraphNode[], edges: GraphEdge[]): string[] {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return edges
      .filter((edge) => edgeType(edge) === 'task-assignment' && edge.targetId === taskId)
      .map((edge) => edge.sourceId)
      .filter((id, index, ids) => {
        const node = nodesById.get(id);
        return node?.type === 'agent' && !isTopLevelAgent(node) && ids.indexOf(id) === index;
      });
  }

  function taskClusterSpacing(
    taskId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    taskAgentDistance: number,
  ): number {
    const agentIds = taskClusterAgentIds(taskId, nodes, edges);
    if (agentIds.length === 0) return NODE_RADII.task * 2;
    return (
      NODE_RADII.task + taskAgentDistance + NODE_RADII.agent + taskHullPadding(agentIds.length + 1)
    );
  }

  function computeTaskClusters(nodes: GraphNode[], edges: GraphEdge[]): TaskCluster[] {
    return nodes
      .filter((node) => node.type === 'task')
      .map((task) => {
        const agentIds = taskClusterAgentIds(task.id, nodes, edges);
        return {
          taskId: task.id,
          agentIds,
          satelliteIds: edges
            .filter(
              (edge) =>
                agentIds.includes(edge.sourceId) &&
                (edgeType(edge).startsWith('file-') || edgeType(edge).startsWith('note-')),
            )
            .map((edge) => edge.targetId),
        };
      })
      .filter((cluster) => cluster.agentIds.length > 0);
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

  function orderTasksByAgentAdjacency(tasks: GraphNode[], edges: GraphEdge[]): GraphNode[] {
    const taskIds = new Set(tasks.map((task) => task.id));
    const sourceOrder = new Map(tasks.map((task, index) => [task.id, index]));
    const tasksByAgent = new Map<string, string[]>();
    for (const assignment of edges.filter((edge) => edgeType(edge) === 'task-assignment')) {
      if (!taskIds.has(assignment.targetId)) continue;
      const assignedTasks = tasksByAgent.get(assignment.sourceId) ?? [];
      if (!assignedTasks.includes(assignment.targetId)) assignedTasks.push(assignment.targetId);
      tasksByAgent.set(assignment.sourceId, assignedTasks);
    }

    const connections = new Map<string, Map<string, number>>();
    const connect = (leftId: string, rightId: string, weight: number): void => {
      if (leftId === rightId) return;
      const neighbors = connections.get(leftId) ?? new Map<string, number>();
      neighbors.set(rightId, (neighbors.get(rightId) ?? 0) + weight);
      connections.set(leftId, neighbors);
    };
    for (const relation of edges.filter((edge) => TASK_ADJACENCY_EDGE_TYPES.has(edgeType(edge)))) {
      for (const leftId of tasksByAgent.get(relation.sourceId) ?? []) {
        for (const rightId of tasksByAgent.get(relation.targetId) ?? []) {
          connect(leftId, rightId, edgeCount(relation));
          connect(rightId, leftId, edgeCount(relation));
        }
      }
    }

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const remaining = new Set(taskIds);
    const ordered: GraphNode[] = [];
    for (const seed of tasks) {
      if (!remaining.has(seed.id)) continue;
      let currentId: string | undefined = seed.id;
      while (currentId) {
        const current = tasksById.get(currentId);
        if (!current) break;
        ordered.push(current);
        remaining.delete(currentId);
        currentId = [...(connections.get(currentId)?.entries() ?? [])]
          .filter(([neighborId]) => remaining.has(neighborId))
          .sort(
            ([leftId, leftWeight], [rightId, rightWeight]) =>
              rightWeight - leftWeight ||
              (sourceOrder.get(leftId) ?? 0) - (sourceOrder.get(rightId) ?? 0),
          )[0]?.[0];
      }
    }
    return ordered;
  }

  function computeTaskAnchors(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
    const tasks = nodes.filter((node) => node.type === 'task');
    const {
      taskAgentDistance,
      orbitX: baseOrbitX,
      orbitY: baseOrbitY,
    } = compactGeometry(nodes.length);
    const spacingByTask = new Map(
      tasks.map((task) => [
        task.id,
        taskClusterSpacing(task.id, nodes, edges, taskAgentDistance) * TASK_ANCHOR_SPACING_RATIO,
      ]),
    );
    let orbitX = baseOrbitX;
    let orbitY = baseOrbitY;
    const anchors = new Map<string, Point>();
    if (tasks.length <= SINGLE_RING_TASK_LIMIT) {
      const orderedTasks = orderTasksByAgentAdjacency(tasks, edges);
      const minimumSpacing = Math.max(0, ...spacingByTask.values());
      const minimumRadius =
        tasks.length > 1 ? minimumSpacing / (2 * Math.sin(Math.PI / tasks.length)) : 0;
      orbitX = Math.max(orbitX, minimumRadius);
      orbitY = Math.max(orbitY, minimumRadius);
      orderedTasks.forEach((task, index) => {
        const angle = -Math.PI / 2 + (index / Math.max(1, orderedTasks.length)) * Math.PI * 2;
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
    const tierOrderedTasks = tasks
      .map((task, index) => ({ task, index, priority: taskPriority.get(task.id) ?? 0 }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .map(({ task }) => task);
    const orderedTasks = orderTasksByAgentAdjacency(tierOrderedTasks, edges);
    let taskIndex = 0;
    let radiusX = orbitX;
    let radiusY = orbitY;
    while (taskIndex < orderedTasks.length) {
      const remainingSpacing = orderedTasks
        .slice(taskIndex)
        .map((task) => spacingByTask.get(task.id) ?? NODE_RADII.task * 2);
      const minimumSpacing = Math.max(...remainingSpacing);
      const capacity = ringCapacity(Math.min(radiusX, radiusY), minimumSpacing);
      const slotOrder = balancedSlotOrder(capacity);
      const ringStart = taskIndex;
      for (let index = 0; index < capacity && taskIndex < orderedTasks.length; index += 1) {
        const task = orderedTasks[taskIndex++];
        const angle = -Math.PI / 2 + (slotOrder[index] / capacity) * Math.PI * 2;
        anchors.set(task.id, {
          x: center.x + Math.cos(angle) * radiusX,
          y: center.y + Math.sin(angle) * radiusY,
        });
      }
      const ringSpacing = Math.max(
        ...orderedTasks
          .slice(ringStart, taskIndex)
          .map((task) => spacingByTask.get(task.id) ?? NODE_RADII.task * 2),
      );
      const ringStep = ringSpacing * TASK_RING_STEP_RATIO;
      radiusX += ringStep;
      radiusY += ringStep;
    }
    return anchors;
  }

  function separationVector(left: HullPoint[], right: HullPoint[]): Point | null {
    let smallestOverlap = Number.POSITIVE_INFINITY;
    let smallestAxis = { x: 0, y: 0 };
    const leftCenter = left.reduce((sum, point) => ({ x: sum.x + point[0], y: sum.y + point[1] }), {
      x: 0,
      y: 0,
    });
    const rightCenter = right.reduce(
      (sum, point) => ({ x: sum.x + point[0], y: sum.y + point[1] }),
      { x: 0, y: 0 },
    );
    leftCenter.x /= left.length;
    leftCenter.y /= left.length;
    rightCenter.x /= right.length;
    rightCenter.y /= right.length;
    for (const polygon of [left, right]) {
      for (let index = 0; index < polygon.length; index += 1) {
        const point = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
        if (length === 0) continue;
        let axis = { x: -(next[1] - point[1]) / length, y: (next[0] - point[0]) / length };
        const leftProjection = left.map(([x, y]) => x * axis.x + y * axis.y);
        const rightProjection = right.map(([x, y]) => x * axis.x + y * axis.y);
        const overlap =
          Math.min(Math.max(...leftProjection), Math.max(...rightProjection)) -
          Math.max(Math.min(...leftProjection), Math.min(...rightProjection));
        if (overlap <= 0) return null;
        if (overlap < smallestOverlap) {
          if (
            (rightCenter.x - leftCenter.x) * axis.x + (rightCenter.y - leftCenter.y) * axis.y <
            0
          ) {
            axis = { x: -axis.x, y: -axis.y };
          }
          smallestOverlap = overlap;
          smallestAxis = axis;
        }
      }
    }
    return {
      x: smallestAxis.x * (smallestOverlap + HULL_SEPARATION_GAP),
      y: smallestAxis.y * (smallestOverlap + HULL_SEPARATION_GAP),
    };
  }

  function separateTaskClusters(
    clusters: TaskCluster[],
    positions: Map<string, Point>,
    maxIterations = clusters.length * 3,
  ): void {
    const polygonFor = (cluster: (typeof clusters)[number]): HullPoint[] | null => {
      const memberIds = [cluster.taskId, ...cluster.agentIds];
      const members = memberIds.flatMap((id) => {
        const position = positions.get(id);
        const node = nodeById.get(id);
        return position && node ? [{ ...position, radius: NODE_RADII[node.type] }] : [];
      });
      return members.length === memberIds.length
        ? paddedHull(members, taskHullPadding(memberIds.length) + HULL_SEPARATION_GAP)
        : null;
    };

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let moved = false;
      const polygons = new Map<string, HullPoint[] | null>();
      const cachedPolygon = (cluster: TaskCluster): HullPoint[] | null => {
        if (!polygons.has(cluster.taskId)) polygons.set(cluster.taskId, polygonFor(cluster));
        return polygons.get(cluster.taskId) ?? null;
      };
      for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
        const left = clusters[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
          const right = clusters[rightIndex];
          if (right.agentIds.some((id) => left.agentIds.includes(id))) continue;
          const leftPolygon = cachedPolygon(left);
          const rightPolygon = cachedPolygon(right);
          if (!leftPolygon || !rightPolygon) continue;
          const shift = separationVector(leftPolygon, rightPolygon);
          if (!shift) continue;
          for (const id of [right.taskId, ...right.agentIds, ...right.satelliteIds]) {
            const position = positions.get(id);
            if (position) positions.set(id, { x: position.x + shift.x, y: position.y + shift.y });
          }
          const anchor = taskAnchors.get(right.taskId);
          if (anchor)
            taskAnchors.set(right.taskId, { x: anchor.x + shift.x, y: anchor.y + shift.y });
          polygons.delete(right.taskId);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  function taskClusterSeparationForce(): Force<GraphNode, undefined> {
    const force = (() => separateCurrentTaskClusters()) as Force<GraphNode, undefined>;
    force.initialize = () => {};
    return force;
  }

  function separateCurrentTaskClusters(): void {
    const positions = new Map(currentNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    separateTaskClusters(taskClusters, positions, 2);
    for (const node of currentNodes) {
      const separated = positions.get(node.id);
      if (!separated || (separated.x === node.x && separated.y === node.y)) continue;
      node.x = separated.x;
      node.y = separated.y;
      desiredPositions.set(node.id, separated);
    }
  }

  function angleFromCenter(point: Point, fallbackId: string): number {
    if (point.x !== center.x || point.y !== center.y) {
      return Math.atan2(point.y - center.y, point.x - center.x);
    }
    return seededUnit(seed, fallbackId, 2) * Math.PI * 2;
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
        const axisOffset = assigned.length === 1 ? AGENT_AXIS_OFFSET : 0;
        const angle = baseAngle + fanOffset + axisOffset;
        positions.set(edge.sourceId, {
          x: taskPosition.x + Math.cos(angle) * taskAgentDistance,
          y: taskPosition.y + Math.sin(angle) * taskAgentDistance,
        });
      });
    }
    separateTaskClusters(taskClusters, positions);

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
        const fanStep = isTopLevelAgent(owner) ? TOP_LEVEL_RESOURCE_FAN_STEP : RESOURCE_FAN_STEP;
        const angle = baseAngle + (index - (resources.length - 1) / 2) * fanStep;
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

  function resourceAnchorForce(edges: GraphEdge[]): Force<GraphNode, undefined> {
    const resources = edges.flatMap((edge) => {
      if (!edgeType(edge).startsWith('file-') && !edgeType(edge).startsWith('note-')) return [];
      const sourceTarget = desiredPositions.get(edge.sourceId);
      const targetPosition = desiredPositions.get(edge.targetId);
      if (!sourceTarget || !targetPosition) return [];
      return [
        {
          edge,
          offsetX: targetPosition.x - sourceTarget.x,
          offsetY: targetPosition.y - sourceTarget.y,
        },
      ];
    });
    const force = ((alpha: number) => {
      for (const { edge, offsetX, offsetY } of resources) {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) continue;
        target.vx += (source.x + offsetX - target.x) * alpha * 2.5;
        target.vy += (source.y + offsetY - target.y) * alpha * 2.5;
      }
    }) as Force<GraphNode, undefined>;
    force.initialize = () => {};
    return force;
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
          return Math.min(0.65, 0.42 + Math.log2(link.count + 1) * 0.04);
        }),
    );
  }

  function configureForces(edges: GraphEdge[]): void {
    const { compact } = compactGeometry(currentNodes.length);
    const compactScale =
      compact && viewport.fitTarget
        ? compactFitScale(currentNodes, viewport.fitTarget)
        : SMALL_GRAPH_FIT_SCALE;
    const compactDimensions = compactNodeDimensions(compactScale);
    taskClusters = computeTaskClusters(currentNodes, edges);
    desiredPositions = computeDesiredPositions(currentNodes, edges);
    simulation
      .nodes(currentNodes)
      .force('collision', null)
      .force('label-collision', null)
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
      compact && viewport.fitTarget
        ? rectangleCollisionForce(compactDimensions, (MIN_COMPACT_NODE_GAP + 1) / compactScale, {
            target: viewport.fitTarget,
            center,
            scale: compactScale,
          })
        : null,
    );
    configureLinkForce(edges);
    simulation.force('resource-anchor', resourceAnchorForce(edges));
    simulation.force('cluster-separation', taskClusterSeparationForce());
    simulation.force(
      'collision',
      compact
        ? rectangleCollisionForce(compactDimensions, (MIN_COMPACT_NODE_GAP + 1) / compactScale)
        : forceCollide<GraphNode>((node) => NODE_RADII[node.type] + GRAPH_NODE_GAPS.collision)
            .strength(1)
            .iterations(4),
    );
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

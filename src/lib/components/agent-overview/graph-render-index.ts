import type { GraphEdge, GraphNode } from './types';

interface NodeActivity {
  isActive: boolean;
  lastActivityAt?: string;
}

interface ResourceAccess {
  access: 'read' | 'write';
  additions: number;
  deletions: number;
  isActive: boolean;
  lastActivityAt?: string;
  lastWriteSourceId?: string;
}

export interface GraphRenderIndex {
  nodeActivityById: ReadonlyMap<string, NodeActivity>;
  resourceAccessById: ReadonlyMap<string, ResourceAccess>;
}

interface TimedNodeActivity extends NodeActivity {
  lastActivityTime: number;
}

interface TimedResourceAccess extends ResourceAccess {
  lastActivityTime: number;
  lastWriteTime: number;
}

function timestampValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function createGraphRenderIndex(nodes: GraphNode[], edges: GraphEdge[]): GraphRenderIndex {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const activities = new Map<string, TimedNodeActivity>();
  const resources = new Map<string, TimedResourceAccess>();

  for (const node of nodes) {
    activities.set(node.id, {
      isActive: node.type === 'agent' && node.status === 'responding',
      lastActivityTime: Number.NEGATIVE_INFINITY,
    });
  }

  for (const edge of edges) {
    const time = timestampValue(edge.timestamp);
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      const activity = activities.get(nodeId);
      const node = nodeById.get(nodeId);
      if (!activity || !node) continue;
      if (node.type !== 'agent' && edge.isActive) activity.isActive = true;
      if (time > activity.lastActivityTime) {
        activity.lastActivityTime = time;
        activity.lastActivityAt = edge.timestamp;
      }
    }

    const target = nodeById.get(edge.targetId);
    if (target?.type === 'task' && edge.type === 'task-assignment') {
      const source = nodeById.get(edge.sourceId);
      if (source?.type === 'agent' && source.status === 'responding') {
        const targetActivity = activities.get(target.id);
        if (targetActivity) targetActivity.isActive = true;
      }
    }
    if (target?.type !== 'file' && target?.type !== 'note') continue;

    const aggregate = resources.get(target.id) ?? {
      access: 'read',
      additions: 0,
      deletions: 0,
      isActive: false,
      lastActivityTime: Number.NEGATIVE_INFINITY,
      lastWriteTime: Number.NEGATIVE_INFINITY,
    };
    aggregate.isActive ||= edge.isActive;
    if (time > aggregate.lastActivityTime) {
      aggregate.lastActivityTime = time;
      aggregate.lastActivityAt = edge.timestamp;
    }
    if (edge.type === 'file-write' || edge.type === 'note-write') {
      aggregate.access = 'write';
      aggregate.additions += edge.additions ?? 0;
      aggregate.deletions += edge.deletions ?? 0;
      if (time > aggregate.lastWriteTime) {
        aggregate.lastWriteTime = time;
        aggregate.lastWriteSourceId = edge.sourceId;
      }
    }
    resources.set(target.id, aggregate);
  }

  return { nodeActivityById: activities, resourceAccessById: resources };
}

export function createGraphRenderIndexMemo() {
  let previousNodes: GraphNode[] | undefined;
  let previousEdges: GraphEdge[] | undefined;
  let previousIndex: GraphRenderIndex | undefined;
  return (nodes: GraphNode[], edges: GraphEdge[]): GraphRenderIndex => {
    if (nodes !== previousNodes || edges !== previousEdges || !previousIndex) {
      previousNodes = nodes;
      previousEdges = edges;
      previousIndex = createGraphRenderIndex(nodes, edges);
    }
    return previousIndex;
  };
}

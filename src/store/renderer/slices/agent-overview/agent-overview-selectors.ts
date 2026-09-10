/**
 * Agent Overview Selectors
 *
 * Selectors for agent overview visualization state.
 * The main selector (selectGraphState) computes the full graph from
 * workspace events, agent sessions, line-changes state, and notes store.
 */

import { store } from '../../store';
import type { StoreState } from '../../types';
import type {
  InteractionEvent,
  GraphState,
  GraphNode,
  GraphEdge,
  AgentNode,
  FileNode,
  NoteNode,
  TaskNode,
} from '$lib/components/agent-overview/types';
import type { FileLineChange } from '$store/renderer/slices/changes/changes-types';
import {
  selectWorkspaceFileChanges,
  selectAgentLineStats,
} from '$store/renderer/slices/changes/changes-selectors';
import {
  selectAgentIsResponding,
  selectAgentIsWaitingForOtherAgents,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import { ACTIVE_EDGE_WINDOW_MS } from '$lib/components/agent-overview/constants';
import {
  getNodeStatus,
  getStreamingState,
  convertToInteractionEvent,
  extractFileChangesFromMessages,
  extractNoteChangesFromMessages,
  extractTaskChangesFromMessages,
  extractDelegationBatchMap,
  isExternalFilePath,
} from '$lib/components/agent-overview/graph-helpers';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { AgentSession, Note, TaskStatus, WorkspaceTask } from '$shared/types';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { selectWorkspaceTasks } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
import { selectTasksForAgent } from '$store/renderer/slices/task-agent-associations/task-agent-associations-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import type { WorkspaceEvent } from '$features/events/types';
import { isValidGraphHistoryTimestamp } from './agent-overview-history-slice';

const TIMELINE_CREATION_LEAD_RATIO = 0.02;
const MIN_TIMELINE_CREATION_LEAD_MS = 1_000;

// ============================================================================
// Private graph derivation helpers
// ============================================================================

function selectSourceEvents(state: StoreState, workspaceId: string): WorkspaceEvent[] {
  const workspaceEvents = (state.workspaceEvents.byWorkspaceId[workspaceId]?.events ?? []).filter(
    (event) => isValidGraphHistoryTimestamp(event.timestamp),
  );
  const history = state.agentOverviewHistory.byWorkspaceId[workspaceId];
  const historyEvents = history
    ? getItems(history.events).filter((event) => isValidGraphHistoryTimestamp(event.timestamp))
    : [];
  return historyEvents.length > 0 ? historyEvents : workspaceEvents;
}

function deriveInteractionEvents(sourceEvents: WorkspaceEvent[]): InteractionEvent[] {
  const interactions: InteractionEvent[] = [];
  const seenQueueMessageIds = new Set<string>();

  for (const event of sourceEvents) {
    interactions.push(...convertToInteractionEvent(event, seenQueueMessageIds));
  }

  return interactions.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

interface TaskStatusChange {
  timestamp: number;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
}

interface TaskHistory {
  createdAtByTaskId: Map<string, number>;
  statusChangesByTaskId: Map<string, TaskStatusChange[]>;
}

function deriveTaskHistory(events: WorkspaceEvent[]): TaskHistory {
  const createdAtByTaskId = new Map<string, number>();
  const statusChangesByTaskId = new Map<string, TaskStatusChange[]>();

  for (const event of events) {
    const data =
      event.data && typeof event.data === 'object'
        ? (event.data as Record<string, unknown>)
        : undefined;
    const taskId = typeof data?.noteId === 'string' ? data.noteId : null;
    if (!taskId) continue;

    const eventType = String(event.type);
    const eventTimestamp = Date.parse(event.timestamp);
    const isCreationEvent =
      eventType === 'task:created' ||
      (eventType === 'note:created' && data?.action === 'create') ||
      eventType === 'task:status-changed';
    if (isCreationEvent && Number.isFinite(eventTimestamp)) {
      const existing = createdAtByTaskId.get(taskId);
      if (existing === undefined || eventTimestamp < existing) {
        createdAtByTaskId.set(taskId, eventTimestamp);
      }
    }

    if (
      eventType !== 'task:status-changed' ||
      typeof data?.previousStatus !== 'string' ||
      typeof data?.newStatus !== 'string'
    ) {
      continue;
    }
    const changedAt = typeof data.changedAt === 'string' ? Date.parse(data.changedAt) : NaN;
    const timestamp = Number.isFinite(changedAt) ? changedAt : eventTimestamp;
    if (!Number.isFinite(timestamp)) continue;
    const changes = statusChangesByTaskId.get(taskId) ?? [];
    changes.push({
      timestamp,
      previousStatus: data.previousStatus as TaskStatus,
      newStatus: data.newStatus as TaskStatus,
    });
    statusChangesByTaskId.set(taskId, changes);
  }

  for (const changes of statusChangesByTaskId.values()) {
    changes.sort((a, b) => a.timestamp - b.timestamp);
  }
  return { createdAtByTaskId, statusChangesByTaskId };
}

function taskTimelineTimestamps(taskHistory: TaskHistory): number[] {
  return [
    ...taskHistory.createdAtByTaskId.values(),
    ...[...taskHistory.statusChangesByTaskId.values()].flatMap((changes) =>
      changes.map((change) => change.timestamp),
    ),
  ];
}

function deriveCurrentTime(events: InteractionEvent[], taskTimestamps: number[]): string {
  const timestamps = [
    ...events.map((event) => new Date(event.timestamp).getTime()),
    ...taskTimestamps,
  ].filter(Number.isFinite);
  if (timestamps.length === 0) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

// ============================================================================
// Graph state selector — the main computed value
// ============================================================================

/**
 * Computes the full graph state from workspace state + line changes.
 * This replaces the $derived computeGraphState from the old Svelte store.
 */
export const selectGraphStateAt = store.createSelector(
  (state, workspaceId: string, requestedTime: string | null): GraphState => {
    const sourceEvents = selectSourceEvents(state, workspaceId);
    const events = deriveInteractionEvents(sourceEvents);
    const taskHistory = deriveTaskHistory(sourceEvents);
    const taskTimestamps = taskTimelineTimestamps(taskHistory);
    const currentTime = requestedTime ?? deriveCurrentTime(events, taskTimestamps);
    const fileChanges: FileLineChange[] = selectWorkspaceFileChanges.select(state, workspaceId);
    const tasks = selectWorkspaceTasks.select(state, workspaceId);
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const rootPaths = [workspace?.path, workspace?.worktreePath].filter(
      (path): path is string => typeof path === 'string' && path.length > 0,
    );

    const agents: Record<string, AgentSession> = {};
    for (const session of selectAllWorkspaceAgents.select(state, workspaceId)) {
      agents[String(session.id)] = session;
    }

    const canonicalTaskIds = new Set(tasks.map((task) => task.id));
    const taskAssignments: Record<string, string> = {};
    for (const [agentId, session] of Object.entries(agents)) {
      const metadataTaskId = session.metadata?.taskNoteId;
      if (metadataTaskId && canonicalTaskIds.has(metadataTaskId)) {
        taskAssignments[agentId] = metadataTaskId;
        continue;
      }
      const linkedTask = selectTasksForAgent
        .select(state, workspaceId, agentId)
        .filter((association) => canonicalTaskIds.has(association.noteId))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (linkedTask) taskAssignments[agentId] = linkedTask.noteId;
    }

    const wsNotes = state.workspaceNotes.byWorkspaceId[workspaceId];
    const notesMap = new Map<string, Note>();
    if (wsNotes) {
      for (const note of getItems(wsNotes.notes)) {
        notesMap.set(note.id, note);
      }
    }

    return computeGraphState(
      events,
      agents,
      currentTime,
      requestedTime === null,
      fileChanges,
      rootPaths,
      state,
      notesMap,
      tasks,
      taskAssignments,
      taskHistory,
      taskTimestamps,
    );
  },
);

/** Live graph alias retained for existing consumers. */
export const selectGraphState = store.createSelector((state, workspaceId: string): GraphState =>
  selectGraphStateAt.select(state, workspaceId, null),
);

// ============================================================================
// computeGraphState — pure function (moved from old Svelte store)
// ============================================================================

function computeGraphState(
  events: InteractionEvent[],
  agents: Record<string, AgentSession>,
  currentTime: string,
  isLive: boolean,
  fileChanges: FileLineChange[],
  rootPaths: string[],
  state: StoreState,
  notesMap?: Map<string, Note>,
  tasks: WorkspaceTask[] = [],
  taskAssignments: Record<string, string> = {},
  taskHistory: TaskHistory = {
    createdAtByTaskId: new Map(),
    statusChangesByTaskId: new Map(),
  },
  taskTimestamps: number[] = [],
): GraphState {
  const currentTimestamp = new Date(currentTime).getTime();

  // Create a map for quick lookup of line changes by file path
  const fileChangesMap = new Map<string, FileLineChange>();
  for (const change of fileChanges) {
    fileChangesMap.set(change.path, change);
  }

  // Get note titles from Redux-provided notes map
  const getNoteTitle = (noteId: string): string => {
    const note = notesMap?.get(noteId);
    return note?.title || noteId;
  };

  // Filter events up to current time
  const visibleEvents = events.filter((e) => new Date(e.timestamp).getTime() <= currentTimestamp);
  const visibleAgents = Object.fromEntries(
    Object.entries(agents).filter(([, session]) => {
      if (isLive || !session.createdAt) return true;
      const createdAt = new Date(String(session.createdAt)).getTime();
      return !Number.isFinite(createdAt) || createdAt <= currentTimestamp;
    }),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();

  const pendingEdges: PendingEdge[] = [];

  // Canonical tasks are constellation anchors, including tasks without agents.
  for (const task of tasks) {
    const createdAt = taskHistory.createdAtByTaskId.get(task.id);
    if (!isLive && createdAt !== undefined && createdAt > currentTimestamp) continue;
    const statusChanges = taskHistory.statusChangesByTaskId.get(task.id);
    const historicalStatus =
      !isLive && statusChanges ? taskStatusAt(statusChanges, currentTimestamp) : null;
    const taskNode: TaskNode = {
      id: task.id,
      type: 'task',
      taskId: task.id,
      title: task.title,
      state: historicalStatus ?? task.status,
      dependsOn: task.dependsOn?.map(String) ?? [],
      lastActionTimestamp: task.updatedAt,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    nodeMap.set(task.id, taskNode);
    nodes.push(taskNode);
  }

  // STEP 1: Find coordinator agent
  let coordinatorId: string | null = null;
  for (const [agentId, session] of Object.entries(visibleAgents)) {
    const parentId =
      (session.metadata?.createdByAgentId as string) || (session as any).parentAgentId || null;
    if (!parentId && !session.isBackground) {
      coordinatorId = agentId;
      break;
    }
  }

  // STEP 2: Create ALL agent nodes from sessions
  for (const [agentId, session] of Object.entries(visibleAgents)) {
    if (nodeMap.has(agentId)) continue;

    const parentId =
      (session.metadata?.createdByAgentId as string) || (session as any).parentAgentId || null;

    const streamingState = getStreamingState(session);
    // Use canonical agent-session selectors for graph-level derived status;
    // UI consumers with agentId subscribe to the selectors directly where possible.
    const isResponding = selectAgentIsResponding.select(state, agentId);
    const isWaitingForOtherAgents = selectAgentIsWaitingForOtherAgents.select(state, agentId);
    // Read the top-level daemon-owned array verbatim (PROTOCOL.md §5.5). The BE
    // emits it on AgentLite (agent.list/get) and chat.subscribe seq-0.
    const historicalStatus = isLive
      ? null
      : (historicalAgentStatus(agentId, visibleEvents) ?? {
          status: 'responding' as const,
          waitingForAgentIds: [],
        });
    const waitingForAgentIds = isLive
      ? session.waitingForAgentIds
      : historicalStatus?.status === 'waiting'
        ? historicalStatus.waitingForAgentIds
        : [];
    const taskNoteId = taskAssignments[agentId] ?? null;

    let nodeStatus = historicalStatus?.status ?? getNodeStatus(session, isResponding);
    if (isLive && isWaitingForOtherAgents) {
      nodeStatus = 'waiting';
    } else if (isLive && isResponding) {
      nodeStatus = 'responding';
    } else if (isLive && nodeStatus === 'idle' && streamingState.activeToolName) {
      nodeStatus = 'responding';
    }

    const agentNode: AgentNode = {
      id: `agent-${agentId}`,
      type: 'agent',
      agentId,
      name: session.name || 'Agent',
      isCoordinator: agentId === coordinatorId,
      isBackground: session.isBackground || false,
      status: nodeStatus,
      specialist: (session.metadata as any)?.specialist || null,
      parentAgentId: parentId,
      taskNoteId,
      createdAt: String(session.createdAt || currentTime),
      waitingForAgentIds,
      activeToolName: isLive ? streamingState.activeToolName : undefined,
      activeToolInput: isLive ? streamingState.activeToolInput : undefined,
      lastResponse: streamingState.lastResponse,
      agentType: (session.metadata as any)?.agentType || null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
    nodeMap.set(agentId, agentNode);
    nodes.push(agentNode);

    if (taskNoteId) {
      const agentCreatedAt = String(session.createdAt || currentTime);
      const agentCreatedTimestamp = Date.parse(agentCreatedAt);
      const taskCreatedTimestamp = taskHistory.createdAtByTaskId.get(taskNoteId);
      const assignmentTimestamp =
        taskCreatedTimestamp === undefined
          ? agentCreatedAt
          : new Date(
              Math.max(
                Number.isFinite(agentCreatedTimestamp)
                  ? agentCreatedTimestamp
                  : taskCreatedTimestamp,
                taskCreatedTimestamp,
              ),
            ).toISOString();
      const assignmentTimestampMs = Date.parse(assignmentTimestamp);
      const edgeKey = `task-assignment-${agentId}-${taskNoteId}`;
      if (
        isLive ||
        !Number.isFinite(assignmentTimestampMs) ||
        assignmentTimestampMs <= currentTimestamp
      ) {
        addPendingEdge(edgeSet, pendingEdges, {
          key: edgeKey,
          sourceRawId: agentId,
          targetRawId: taskNoteId,
          edge: {
            id: edgeKey,
            type: 'task-assignment',
            sourceId: `agent-${agentId}`,
            targetId: taskNoteId,
            agentId,
            taskId: taskNoteId,
            timestamp: assignmentTimestamp,
            isActive: false,
          },
        });
      }
    }

    // Queue delegation edge if parent exists
    if (parentId && visibleAgents[parentId]) {
      const edgeKey = `del-${parentId}-${agentId}`;
      if (!edgeSet.has(edgeKey)) {
        addPendingEdge(edgeSet, pendingEdges, {
          key: edgeKey,
          sourceRawId: parentId,
          targetRawId: agentId,
          edge: {
            id: edgeKey,
            type: 'delegation',
            sourceId: `agent-${parentId}`,
            targetId: `agent-${agentId}`,
            parentAgentId: parentId,
            childAgentId: agentId,
            timestamp: String(session.createdAt || currentTime),
            isActive: false,
          },
        });
      }
    }

    // STEP 3: Create file nodes from agent's chat history
    const messages = (session.messages || []).filter((message) => {
      if (isLive || !message.timestamp) return true;
      return new Date(String(message.timestamp)).getTime() <= currentTimestamp;
    });
    const extractedFileChanges = extractFileChangesFromMessages(messages, currentTime);

    let fileChangesToProcess = extractedFileChanges.map((fc) => ({
      ...fc,
      additions: fileChangesMap.get(fc.path)?.additions,
      deletions: fileChangesMap.get(fc.path)?.deletions,
    }));

    if (
      isLive &&
      fileChangesToProcess.length === 0 &&
      session.fileChanges &&
      session.fileChanges.length > 0
    ) {
      fileChangesToProcess = session.fileChanges.map((fc) => ({
        path: fc.path,
        type: fc.type as 'create' | 'modify' | 'delete',
        timestamp: String(fc.timestamp || currentTime),
        additions: fileChangesMap.get(fc.path)?.additions,
        deletions: fileChangesMap.get(fc.path)?.deletions,
      }));
    }

    createFileNodesAndEdges(
      fileChangesToProcess,
      agentId,
      fileChangesMap,
      nodeMap,
      nodes,
      edgeSet,
      pendingEdges,
      currentTime,
      rootPaths,
    );

    // STEP 3.5: Create note nodes from agent's chat history
    const extractedNoteChanges = extractNoteChangesFromMessages(messages, currentTime);
    createNoteNodesAndEdges(
      extractedNoteChanges,
      agentId,
      getNoteTitle,
      nodeMap,
      nodes,
      edgeSet,
      pendingEdges,
    );

    // STEP 3.6: Create task nodes from agent's chat history
    const extractedTaskChanges = extractTaskChangesFromMessages(messages, currentTime);
    createTaskNodesAndEdges(extractedTaskChanges, agentId, nodeMap, nodes, edgeSet, pendingEdges);
  }

  // STEP 3.7: Compute delegation batch IDs
  for (const [agentId, session] of Object.entries(visibleAgents)) {
    const messages = (session.messages || []).filter((message) => {
      if (isLive || !message.timestamp) return true;
      return new Date(String(message.timestamp)).getTime() <= currentTimestamp;
    });
    if (messages.length === 0) continue;
    const batchMap = extractDelegationBatchMap(messages, agentId);
    if (batchMap.size === 0) continue;
    for (const [childAgentId, batchId] of batchMap) {
      const childNode = nodeMap.get(childAgentId);
      if (childNode && childNode.type === 'agent') {
        (childNode as AgentNode).delegationBatchId = batchId;
      }
    }
  }

  // STEP 4: Process events for additional nodes and edges
  processVisibleEvents(
    visibleEvents,
    currentTimestamp,
    fileChangesMap,
    getNoteTitle,
    nodeMap,
    nodes,
    edgeSet,
    pendingEdges,
    rootPaths,
  );

  // The latest session snapshot can describe a live wait even when its event is
  // outside the retained activity window.
  for (const [agentId, session] of Object.entries(visibleAgents)) {
    if (!isLive) break;
    for (const targetAgentId of session.waitingForAgentIds ?? []) {
      const edgeKey = `waiting-on-${agentId}-${targetAgentId}`;
      const existing = pendingEdges.find((candidate) => candidate.key === edgeKey);
      if (existing) {
        existing.edge.isActive = true;
        continue;
      }
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: agentId,
        targetRawId: targetAgentId,
        edge: {
          id: edgeKey,
          type: 'waiting-on',
          sourceId: `agent-${agentId}`,
          targetId: `agent-${targetAgentId}`,
          waiterAgentId: agentId,
          targetAgentId,
          timestamp: currentTime,
          isActive: true,
          count: 1,
        },
      });
    }
  }

  // STEP 4b: Fallback file nodes from workspace-level changes
  createFallbackFileNodes(
    nodes,
    isLive ? fileChanges : [],
    visibleAgents,
    coordinatorId,
    nodeMap,
    edgeSet,
    edges,
    isLive,
    currentTime,
    state,
    rootPaths,
  );

  // STEP 5: Create edges where both nodes exist
  for (const pending of pendingEdges) {
    if (nodeMap.has(pending.sourceRawId) && nodeMap.has(pending.targetRawId)) {
      edges.push(pending.edge);
    }
  }

  const timestamps = events.map((e) => new Date(e.timestamp).getTime());
  const agentCreatedAtTimestamps = Object.values(agents)
    .map((session) => new Date(String(session.createdAt)).getTime())
    .filter(Number.isFinite);
  const taskCreatedAtTimestamps = [...taskHistory.createdAtByTaskId.values()];
  const creationTimestamps = [...agentCreatedAtTimestamps, ...taskCreatedAtTimestamps];
  const maxTimestamp = Math.max(
    currentTimestamp,
    ...timestamps,
    ...creationTimestamps,
    ...taskTimestamps,
  );
  let minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : currentTimestamp;
  if (creationTimestamps.length > 0) {
    minTimestamp = Math.min(minTimestamp, ...creationTimestamps);
    const leadTime = Math.max(
      MIN_TIMELINE_CREATION_LEAD_MS,
      (maxTimestamp - minTimestamp) * TIMELINE_CREATION_LEAD_RATIO,
    );
    minTimestamp -= leadTime;
  }
  const minTime = new Date(minTimestamp).toISOString();
  const maxTime = new Date(maxTimestamp).toISOString();

  const taskStats: Record<TaskStatus, number> = {
    not_started: 0,
    waiting: 0,
    discussion_needed: 0,
    blocked: 0,
    in_progress: 0,
    review_required: 0,
    complete: 0,
    cancelled: 0,
  };
  for (const node of nodes) {
    if (node.type === 'task') taskStats[node.state] += 1;
  }
  const agentNodes = nodes.filter((node): node is AgentNode => node.type === 'agent');
  const stats = {
    agents: {
      active: agentNodes.filter((node) => node.status === 'responding' || node.status === 'waiting')
        .length,
      total: agentNodes.length,
    },
    tasks: taskStats,
    files: nodes.filter((node) => node.type === 'file').length,
    notes: nodes.filter((node) => node.type === 'note').length,
  };

  return {
    nodes,
    edges,
    stats,
    currentTime,
    isLive,
    minTime,
    maxTime,
    eventTimes: [
      ...events.map((event) => event.timestamp),
      ...taskTimestamps.map((timestamp) => new Date(timestamp).toISOString()),
    ],
  };
}

// ============================================================================
// Helper functions extracted from computeGraphState for readability
// ============================================================================

interface PendingEdge {
  key: string;
  sourceRawId: string;
  targetRawId: string;
  edge: GraphEdge;
}

function taskStatusAt(changes: TaskStatusChange[], currentTimestamp: number): TaskStatus {
  const latest = changes.findLast((change) => change.timestamp <= currentTimestamp);
  return latest?.newStatus ?? changes[0].previousStatus;
}

function historicalAgentStatus(
  agentId: string,
  events: InteractionEvent[],
): { status: AgentNode['status']; waitingForAgentIds: string[] } | null {
  const latest = events
    .filter((event) => event.agentId === agentId)
    .toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (!latest) return null;
  if (latest.type === 'agent-idle') return { status: 'idle', waitingForAgentIds: [] };
  if (latest.type === 'agent-waiting') {
    return { status: 'waiting', waitingForAgentIds: latest.targetId ? [latest.targetId] : [] };
  }
  return { status: 'responding', waitingForAgentIds: [] };
}

function addPendingEdge(
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
  pending: PendingEdge,
): void {
  const existing = pendingEdges.find((candidate) => candidate.key === pending.key);
  if (existing) {
    if (pending.edge.count !== undefined) {
      existing.edge.count = (existing.edge.count ?? 0) + pending.edge.count;
    }
    if (new Date(pending.edge.timestamp).getTime() >= new Date(existing.edge.timestamp).getTime()) {
      existing.edge.timestamp = pending.edge.timestamp;
      existing.edge.isActive = pending.edge.isActive;
      existing.edge.additions = pending.edge.additions ?? existing.edge.additions;
      existing.edge.deletions = pending.edge.deletions ?? existing.edge.deletions;
    } else if (pending.edge.isActive) {
      existing.edge.isActive = true;
    }
    return;
  }

  edgeSet.add(pending.key);
  pendingEdges.push(pending);
}

function createFileNodesAndEdges(
  fileChangesToProcess: Array<{
    path: string;
    type: string;
    timestamp: string;
    additions?: number;
    deletions?: number;
  }>,
  agentId: string,
  fileChangesMap: Map<string, FileLineChange>,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
  currentTime: string,
  rootPaths: string[],
) {
  for (const fc of fileChangesToProcess) {
    const filePath = fc.path;
    if (!filePath) continue;

    const isRead = fc.type === 'read';
    const edgeType = isRead ? 'file-read' : 'file-write';
    const fileId = `file-${filePath}`;

    if (!nodeMap.has(filePath)) {
      const fileNode: FileNode = {
        id: fileId,
        type: 'file',
        path: filePath,
        fileName: filePath.split('/').pop() || '',
        isExternal: isExternalFilePath(filePath, rootPaths),
        lastAction: fc.type === 'delete' ? 'delete' : isRead ? 'read' : 'write',
        lastActionTimestamp: fc.timestamp || currentTime,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(filePath, fileNode);
      nodes.push(fileNode);
    }

    const edgeKey = `${edgeType}-${agentId}-${filePath}`;
    const fileLineChange = !isRead ? fileChangesMap.get(filePath) : undefined;
    let additions = !isRead ? (fc.additions ?? fileLineChange?.additions) : undefined;
    let deletions = !isRead ? (fc.deletions ?? fileLineChange?.deletions) : undefined;

    if (!isRead && additions === undefined && deletions === undefined) {
      const hash = filePath.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      if (fc.type === 'create') {
        additions = (hash % 80) + 20;
        deletions = 0;
      } else if (fc.type === 'modify') {
        additions = (hash % 50) + 5;
        deletions = (hash % 20) + 2;
      } else {
        additions = (hash % 30) + 3;
        deletions = (hash % 15) + 1;
      }
    }

    addPendingEdge(edgeSet, pendingEdges, {
      key: edgeKey,
      sourceRawId: agentId,
      targetRawId: filePath,
      edge: {
        id: edgeKey,
        type: edgeType,
        sourceId: `agent-${agentId}`,
        targetId: fileId,
        agentId,
        filePath,
        timestamp: fc.timestamp || currentTime,
        isActive: false,
        count: 1,
        additions,
        deletions,
      },
    });
  }
}

function createNoteNodesAndEdges(
  noteChanges: Array<{ noteId: string; action: string; timestamp: string }>,
  agentId: string,
  getNoteTitle: (noteId: string) => string,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
) {
  for (const nc of noteChanges) {
    const noteId = nc.noteId;
    const nodeKey = `note-${noteId}`;

    if (!nodeMap.has(noteId)) {
      const noteNode: NoteNode = {
        id: nodeKey,
        type: 'note',
        noteId,
        title: getNoteTitle(noteId),
        lastAction: nc.action as NoteNode['lastAction'],
        lastActionTimestamp: nc.timestamp,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(noteId, noteNode);
      nodes.push(noteNode);
    }

    const edgeType = nc.action === 'read' ? 'note-read' : 'note-write';
    const edgeKey = `${edgeType}-${agentId}-${noteId}`;
    addPendingEdge(edgeSet, pendingEdges, {
      key: edgeKey,
      sourceRawId: agentId,
      targetRawId: noteId,
      edge: {
        id: edgeKey,
        type: edgeType,
        sourceId: `agent-${agentId}`,
        targetId: nodeKey,
        agentId,
        noteId,
        timestamp: nc.timestamp,
        isActive: false,
        count: 1,
      },
    });
  }
}

function createTaskNodesAndEdges(
  taskChanges: Array<{
    taskId: string;
    name: string;
    description?: string;
    state?: string;
    action: string;
    timestamp: string;
  }>,
  agentId: string,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
) {
  for (const tc of taskChanges) {
    const taskId = tc.taskId;
    const nodeKey = taskId;

    if (!nodeMap.has(taskId)) {
      const taskNode: TaskNode = {
        id: nodeKey,
        type: 'task',
        taskId,
        title: tc.name,
        description: tc.description,
        state: (tc.state as TaskNode['state']) || 'not_started',
        dependsOn: [],
        lastAction: tc.action as TaskNode['lastAction'],
        lastActionTimestamp: tc.timestamp,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(taskId, taskNode);
      nodes.push(taskNode);
    }

    const edgeType = tc.action === 'create' ? 'task-create' : 'task-update';
    const edgeKey = `${edgeType}-${agentId}-${taskId}`;
    if (!edgeSet.has(edgeKey)) {
      pendingEdges.push({
        key: edgeKey,
        sourceRawId: agentId,
        targetRawId: taskId,
        edge: {
          id: edgeKey,
          type: edgeType,
          sourceId: `agent-${agentId}`,
          targetId: nodeKey,
          agentId,
          taskId,
          timestamp: tc.timestamp,
          isActive: false,
        },
      });
      edgeSet.add(edgeKey);
    }
  }
}

function processVisibleEvents(
  visibleEvents: InteractionEvent[],
  currentTimestamp: number,
  fileChangesMap: Map<string, FileLineChange>,
  getNoteTitle: (noteId: string) => string,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
  rootPaths: string[],
) {
  for (const event of visibleEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    const isActive = currentTimestamp - eventTime < ACTIVE_EDGE_WINDOW_MS;

    if (event.type === 'agent-created' || event.type === 'agent-idle') {
      if (event.parentAgentId) {
        const edgeKey = `del-${event.parentAgentId}-${event.agentId}`;
        if (!edgeSet.has(edgeKey)) {
          addPendingEdge(edgeSet, pendingEdges, {
            key: edgeKey,
            sourceRawId: event.parentAgentId,
            targetRawId: event.agentId,
            edge: {
              id: edgeKey,
              type: 'delegation',
              sourceId: `agent-${event.parentAgentId}`,
              targetId: `agent-${event.agentId}`,
              parentAgentId: event.parentAgentId,
              childAgentId: event.agentId,
              timestamp: event.timestamp,
              isActive,
            },
          });
        }
      }
    }

    if ((event.type === 'file-read' || event.type === 'file-write') && event.targetId) {
      const fileId = `file-${event.targetId}`;
      if (!nodeMap.has(event.targetId)) {
        const fileNode: FileNode = {
          id: fileId,
          type: 'file',
          path: event.targetId,
          fileName: event.targetName || event.targetId.split('/').pop() || '',
          isExternal: isExternalFilePath(event.targetId, rootPaths),
          lastAction: event.type === 'file-write' ? 'write' : 'read',
          lastActionTimestamp: event.timestamp,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        };
        nodeMap.set(event.targetId, fileNode);
        nodes.push(fileNode);
      }

      const edgeKey = `${event.type}-${event.agentId}-${event.targetId}`;
      const fileLineChange =
        event.type === 'file-write' ? fileChangesMap.get(event.targetId) : undefined;
      let additions = fileLineChange?.additions;
      let deletions = fileLineChange?.deletions;
      if (event.type === 'file-write' && additions === undefined && deletions === undefined) {
        const hash = event.targetId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        additions = (hash % 50) + 5;
        deletions = (hash % 20) + 2;
      }
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: event.agentId,
        targetRawId: event.targetId,
        edge: {
          id: edgeKey,
          type: event.type,
          sourceId: `agent-${event.agentId}`,
          targetId: fileId,
          agentId: event.agentId,
          filePath: event.targetId,
          timestamp: event.timestamp,
          isActive,
          count: 1,
          additions,
          deletions,
        },
      });
    }

    if ((event.type === 'note-read' || event.type === 'note-write') && event.targetId) {
      const noteId = `note-${event.targetId}`;
      if (!nodeMap.has(event.targetId)) {
        const noteNode: NoteNode = {
          id: noteId,
          type: 'note',
          noteId: event.targetId,
          title: getNoteTitle(event.targetId) || event.targetName || event.targetId,
          lastAction: event.type === 'note-write' ? 'write' : 'read',
          lastActionTimestamp: event.timestamp,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        };
        nodeMap.set(event.targetId, noteNode);
        nodes.push(noteNode);
      }

      const edgeKey = `${event.type}-${event.agentId}-${event.targetId}`;
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: event.agentId,
        targetRawId: event.targetId,
        edge: {
          id: edgeKey,
          type: event.type,
          sourceId: `agent-${event.agentId}`,
          targetId: noteId,
          agentId: event.agentId,
          noteId: event.targetId,
          timestamp: event.timestamp,
          isActive,
          count: 1,
        },
      });
    }

    if (event.type === 'task-update' && event.targetId && nodeMap.has(event.targetId)) {
      const agentNode = nodeMap.get(event.agentId);
      if (agentNode?.type === 'agent' && !agentNode.taskNoteId) {
        agentNode.taskNoteId = event.targetId;
      }
      const edgeKey = `task-assignment-${event.agentId}-${event.targetId}`;
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: event.agentId,
        targetRawId: event.targetId,
        edge: {
          id: edgeKey,
          type: 'task-assignment',
          sourceId: `agent-${event.agentId}`,
          targetId: event.targetId,
          agentId: event.agentId,
          taskId: event.targetId,
          timestamp: event.timestamp,
          isActive,
        },
      });
    }

    if (event.type === 'agent-message' && event.targetId) {
      const edgeKey = `message-${event.agentId}-${event.targetId}`;
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: event.agentId,
        targetRawId: event.targetId,
        edge: {
          id: edgeKey,
          type: 'message',
          sourceId: `agent-${event.agentId}`,
          targetId: `agent-${event.targetId}`,
          senderAgentId: event.agentId,
          receiverAgentId: event.targetId,
          timestamp: event.timestamp,
          isActive,
          count: 1,
        },
      });
    }

    if (event.type === 'agent-waiting' && event.targetId) {
      const edgeKey = `waiting-on-${event.agentId}-${event.targetId}`;
      addPendingEdge(edgeSet, pendingEdges, {
        key: edgeKey,
        sourceRawId: event.agentId,
        targetRawId: event.targetId,
        edge: {
          id: edgeKey,
          type: 'waiting-on',
          sourceId: `agent-${event.agentId}`,
          targetId: `agent-${event.targetId}`,
          waiterAgentId: event.agentId,
          targetAgentId: event.targetId,
          timestamp: event.timestamp,
          isActive,
          count: 1,
        },
      });
    }
  }
}

function createFallbackFileNodes(
  nodes: GraphNode[],
  fileChanges: FileLineChange[],
  agents: Record<string, AgentSession>,
  coordinatorId: string | null,
  nodeMap: Map<string, GraphNode>,
  edgeSet: Set<string>,
  edges: GraphEdge[],
  isLive: boolean,
  currentTime: string,

  state: StoreState,
  rootPaths: string[],
) {
  const hasFileNodes = nodes.some((n) => n.type === 'file');
  if (hasFileNodes || fileChanges.length === 0) return;

  // Find agents that have file change stats
  const agentsWithEdits: string[] = [];
  for (const agentId of Object.keys(agents)) {
    const stats = selectAgentLineStats.select(state, agentId);
    if (stats && (stats.additions > 0 || stats.deletions > 0)) {
      agentsWithEdits.push(agentId);
    }
  }

  const linkAgentId = agentsWithEdits.length > 0 ? agentsWithEdits[0] : coordinatorId;
  if (!linkAgentId || !nodeMap.has(linkAgentId)) return;

  for (const fc of fileChanges) {
    const filePath = fc.path;
    if (!filePath) continue;

    const fileId = `file-${filePath}`;
    if (!nodeMap.has(filePath)) {
      const fileNode: FileNode = {
        id: fileId,
        type: 'file',
        path: filePath,
        fileName: filePath.split('/').pop() || '',
        isExternal: isExternalFilePath(filePath, rootPaths),
        lastAction: fc.action?.toLowerCase() === 'delete' ? 'delete' : 'write',
        lastActionTimestamp: currentTime,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      nodeMap.set(filePath, fileNode);
      nodes.push(fileNode);

      const edgeKey = `file-write-${linkAgentId}-${filePath}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({
          id: edgeKey,
          type: 'file-write',
          sourceId: `agent-${linkAgentId}`,
          targetId: fileId,
          agentId: linkAgentId,
          filePath,
          timestamp: currentTime,
          isActive: isLive,
          count: 1,
          additions: fc.additions,
          deletions: fc.deletions,
        });
      }
    }
  }
}

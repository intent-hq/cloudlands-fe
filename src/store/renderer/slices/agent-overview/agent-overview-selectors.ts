/**
 * Agent Overview Selectors
 *
 * Selectors for agent overview visualization state.
 * The main selector (selectGraphState) computes the full graph from
 * workspace events, agent sessions, line-changes state, and notes store.
 */

import { store } from "../../store";
import type { StoreState } from "../../types";
import type { InteractionEvent,
  GraphState,
  GraphNode,
  GraphEdge,
  AgentNode,
  FileNode,
  NoteNode,
  TaskNode } from "$lib/components/agent-overview/types";
import type { FileLineChange } from "$store/renderer/slices/changes/changes-types";
import {
  selectWorkspaceFileChanges,
  selectAgentLineStats,
} from "$store/renderer/slices/changes/changes-selectors";
import {
  selectAgentIsResponding,
  selectAgentIsWaitingForOtherAgents,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import { ACTIVE_EDGE_WINDOW_MS } from "$lib/components/agent-overview/constants";
import {
  getNodeStatus,
  getStreamingState,
  convertToInteractionEvent,
  extractFileChangesFromMessages,
  extractNoteChangesFromMessages,
  extractTaskChangesFromMessages,
  extractDelegationBatchMap,
} from "$lib/components/agent-overview/graph-helpers";
import { getItems } from "ag-redux-toolkit/utils/collections/collection-utils";
import type { AgentSession,
  Note } from "$shared/types";
import { selectAllWorkspaceAgents } from "$store/renderer/slices/workspace-agents/workspace-agents-selectors";

// ============================================================================
// Private graph derivation helpers
// ============================================================================

function deriveInteractionEvents(state: StoreState, workspaceId: string): InteractionEvent[] {
  const workspaceEvents = state.workspaceEvents.byWorkspaceId[workspaceId]?.events ?? [];
  const interactions: InteractionEvent[] = [];

  for (const event of workspaceEvents) {
    const interaction = convertToInteractionEvent(event);
    if (interaction) interactions.push(interaction);
  }

  return interactions.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function deriveCurrentTime(events: InteractionEvent[]): string {
  if (events.length === 0) return new Date().toISOString();
  return new Date(Math.max(...events.map((event) => new Date(event.timestamp).getTime()))).toISOString();
}

// ============================================================================
// Graph state selector — the main computed value
// ============================================================================

/**
 * Computes the full graph state from workspace state + line changes.
 * This replaces the $derived computeGraphState from the old Svelte store.
 */
export const selectGraphState = store.createSelector(
  (state, workspaceId: string): GraphState => {
    const events = deriveInteractionEvents(state, workspaceId);
    const currentTime = deriveCurrentTime(events);
    const fileChanges: FileLineChange[] = selectWorkspaceFileChanges.select(state, workspaceId);

    // Derive agents from workspace agentIds + the canonical agent-session slice.
    const agents: Record<string, AgentSession> = {};
    for (const session of selectAllWorkspaceAgents.select(state, workspaceId)) {
      agents[String(session.id)] = session;
    }

    // Build a note title lookup from Redux state (replaces old notesStore.notes access)
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
      true,
      fileChanges,
      state,
      notesMap,
    );
  },
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
  state: StoreState,
  notesMap?: Map<string, Note>,
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
  const visibleEvents = events.filter(
    (e) => new Date(e.timestamp).getTime() <= currentTimestamp,
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();

  interface PendingEdge {
    key: string;
    sourceRawId: string;
    targetRawId: string;
    edge: GraphEdge;
  }
  const pendingEdges: PendingEdge[] = [];

  // STEP 1: Find coordinator agent
  let coordinatorId: string | null = null;
  for (const [agentId, session] of Object.entries(agents)) {
    const parentId =
      (session.metadata?.createdByAgentId as string) ||
      (session as any).parentAgentId ||
      null;
    if (!parentId && !session.isBackground) {
      coordinatorId = agentId;
      break;
    }
  }

  // STEP 2: Create ALL agent nodes from sessions
  for (const [agentId, session] of Object.entries(agents)) {
    if (nodeMap.has(agentId)) continue;

    const parentId =
      (session.metadata?.createdByAgentId as string) ||
      (session as any).parentAgentId ||
      null;

    const streamingState = getStreamingState(session);
    // Use canonical agent-session selectors for graph-level derived status;
    // UI consumers with agentId subscribe to the selectors directly where possible.
    const isResponding = selectAgentIsResponding.select(state, agentId);
    const isWaitingForOtherAgents = selectAgentIsWaitingForOtherAgents.select(state, agentId);
    const waitingForAgentIds = (session.metadata as any)?.waitingForAgentIds as string[] | undefined;

    let nodeStatus = getNodeStatus(session, isResponding);
    if (isWaitingForOtherAgents) {
      nodeStatus = 'waiting';
    } else if (isResponding) {
      nodeStatus = 'responding';
    } else if (nodeStatus === 'idle' && (streamingState.activeToolName || streamingState.streamingText)) {
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
      createdAt: String(session.createdAt || currentTime),
      waitingForAgentIds,
      streamingText: streamingState.streamingText,
      activeToolName: streamingState.activeToolName,
      activeToolInput: streamingState.activeToolInput,
      lastResponse: streamingState.lastResponse,
      agentType: (session.metadata as any)?.agentType || null,
      x: 0, y: 0, vx: 0, vy: 0,
    };
    nodeMap.set(agentId, agentNode);
    nodes.push(agentNode);

    // Queue delegation edge if parent exists
    if (parentId && agents[parentId]) {
      const edgeKey = `del-${parentId}-${agentId}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        pendingEdges.push({
          key: edgeKey, sourceRawId: parentId, targetRawId: agentId,
          edge: {
            id: edgeKey, type: 'delegation',
            sourceId: `agent-${parentId}`, targetId: `agent-${agentId}`,
            parentAgentId: parentId, childAgentId: agentId,
            timestamp: String(session.createdAt || currentTime), isActive: false,
          },
        });
      }
    }

    // STEP 3: Create file nodes from agent's chat history
    const messages = session.messages || [];
    const extractedFileChanges = extractFileChangesFromMessages(messages, currentTime);

    let fileChangesToProcess = extractedFileChanges.map(fc => ({
      ...fc,
      additions: fileChangesMap.get(fc.path)?.additions,
      deletions: fileChangesMap.get(fc.path)?.deletions,
    }));

    if (fileChangesToProcess.length === 0 && session.fileChanges && session.fileChanges.length > 0) {
      fileChangesToProcess = session.fileChanges.map(fc => ({
        path: fc.path,
        type: fc.type as 'create' | 'modify' | 'delete',
        timestamp: String(fc.timestamp || currentTime),
        additions: fileChangesMap.get(fc.path)?.additions,
        deletions: fileChangesMap.get(fc.path)?.deletions,
      }));
    }

    createFileNodesAndEdges(fileChangesToProcess, agentId, fileChangesMap, nodeMap, nodes, edgeSet, pendingEdges, currentTime);

    // STEP 3.5: Create note nodes from agent's chat history
    const extractedNoteChanges = extractNoteChangesFromMessages(messages, currentTime);
    createNoteNodesAndEdges(extractedNoteChanges, agentId, getNoteTitle, nodeMap, nodes, edgeSet, pendingEdges);

    // STEP 3.6: Create task nodes from agent's chat history
    const extractedTaskChanges = extractTaskChangesFromMessages(messages, currentTime);
    createTaskNodesAndEdges(extractedTaskChanges, agentId, nodeMap, nodes, edgeSet, pendingEdges);
  }

  // STEP 3.7: Compute delegation batch IDs
  for (const [agentId, session] of Object.entries(agents)) {
    const messages = session.messages || [];
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
    isLive,
    currentTimestamp,
    agents,
    fileChangesMap,
    getNoteTitle,
    nodeMap,
    nodes,
    edgeSet,
    pendingEdges,
  );

  // STEP 4b: Fallback file nodes from workspace-level changes
  createFallbackFileNodes(nodes, fileChanges, agents, coordinatorId, nodeMap, edgeSet, edges, isLive, currentTime, state);

  // STEP 5: Create edges where both nodes exist
  for (const pending of pendingEdges) {
    if (nodeMap.has(pending.sourceRawId) && nodeMap.has(pending.targetRawId)) {
      edges.push(pending.edge);
    }
  }

  const timestamps = events.map((e) => new Date(e.timestamp).getTime());
  const minTime = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : currentTime;
  const maxTime = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : currentTime;

  return { nodes, edges, currentTime, isLive, minTime, maxTime };
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

function createFileNodesAndEdges(
  fileChangesToProcess: Array<{ path: string; type: string; timestamp: string; additions?: number; deletions?: number }>,
  agentId: string,
  fileChangesMap: Map<string, FileLineChange>,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
  currentTime: string,
) {
  for (const fc of fileChangesToProcess) {
    const filePath = fc.path;
    if (!filePath) continue;

    const isRead = fc.type === 'read';
    const edgeType = isRead ? 'file-read' : 'file-write';
    const fileId = `file-${filePath}`;

    if (!nodeMap.has(filePath)) {
      const fileNode: FileNode = {
        id: fileId, type: 'file', path: filePath,
        fileName: filePath.split('/').pop() || '',
        lastAction: fc.type === 'delete' ? 'delete' : isRead ? 'read' : 'write',
        lastActionTimestamp: fc.timestamp || currentTime,
        x: 0, y: 0, vx: 0, vy: 0,
      };
      nodeMap.set(filePath, fileNode);
      nodes.push(fileNode);
    }

    const edgeKey = `${edgeType}-${agentId}-${filePath}`;
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      const fileLineChange = !isRead ? fileChangesMap.get(filePath) : undefined;
      let additions = !isRead ? (fc.additions ?? fileLineChange?.additions) : undefined;
      let deletions = !isRead ? (fc.deletions ?? fileLineChange?.deletions) : undefined;

      if (!isRead && additions === undefined && deletions === undefined) {
        const hash = filePath.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        if (fc.type === 'create') { additions = (hash % 80) + 20; deletions = 0; }
        else if (fc.type === 'modify') { additions = (hash % 50) + 5; deletions = (hash % 20) + 2; }
        else { additions = (hash % 30) + 3; deletions = (hash % 15) + 1; }
      }

      pendingEdges.push({
        key: edgeKey, sourceRawId: agentId, targetRawId: filePath,
        edge: {
          id: edgeKey, type: edgeType, sourceId: `agent-${agentId}`, targetId: fileId,
          agentId, filePath, timestamp: fc.timestamp || currentTime, isActive: false,
          additions, deletions,
        },
      });
    }
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
        id: nodeKey, type: 'note', noteId,
        title: getNoteTitle(noteId),
        lastAction: nc.action as NoteNode['lastAction'],
        lastActionTimestamp: nc.timestamp,
        x: 0, y: 0, vx: 0, vy: 0,
      };
      nodeMap.set(noteId, noteNode);
      nodes.push(noteNode);
    }

    const edgeType = nc.action === 'read' ? 'note-read' : 'note-write';
    const edgeKey = `${edgeType}-${agentId}-${noteId}`;
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      pendingEdges.push({
        key: edgeKey, sourceRawId: agentId, targetRawId: noteId,
        edge: {
          id: edgeKey, type: edgeType, sourceId: `agent-${agentId}`, targetId: nodeKey,
          agentId, noteId, timestamp: nc.timestamp, isActive: false,
        },
      });
    }
  }
}


function createTaskNodesAndEdges(
  taskChanges: Array<{ taskId: string; name: string; description?: string; state?: string; action: string; timestamp: string }>,
  agentId: string,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
) {
  for (const tc of taskChanges) {
    const taskId = tc.taskId;
    const nodeKey = `task-${taskId}`;

    if (!nodeMap.has(taskId)) {
      const taskNode: TaskNode = {
        id: nodeKey, type: 'task', taskId,
        name: tc.name, description: tc.description,
        state: (tc.state as TaskNode['state']) || 'not_started',
        lastAction: tc.action as TaskNode['lastAction'],
        lastActionTimestamp: tc.timestamp,
        x: 0, y: 0, vx: 0, vy: 0,
      };
      nodeMap.set(taskId, taskNode);
      nodes.push(taskNode);
    }

    const edgeType = tc.action === 'create' ? 'task-create' : 'task-update';
    const edgeKey = `${edgeType}-${agentId}-${taskId}`;
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      pendingEdges.push({
        key: edgeKey, sourceRawId: agentId, targetRawId: taskId,
        edge: {
          id: edgeKey, type: edgeType, sourceId: `agent-${agentId}`, targetId: nodeKey,
          agentId, taskId, timestamp: tc.timestamp, isActive: false,
        },
      });
    }
  }
}

function processVisibleEvents(
  visibleEvents: InteractionEvent[],
  isLive: boolean,
  currentTimestamp: number,
  agents: Record<string, AgentSession>,
  fileChangesMap: Map<string, FileLineChange>,
  getNoteTitle: (noteId: string) => string,
  nodeMap: Map<string, GraphNode>,
  nodes: GraphNode[],
  edgeSet: Set<string>,
  pendingEdges: PendingEdge[],
) {
  for (const event of visibleEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    const isActive = isLive && currentTimestamp - eventTime < ACTIVE_EDGE_WINDOW_MS;

    if (event.type === 'agent-created' || event.type === 'agent-idle') {
      if (event.parentAgentId) {
        const edgeKey = `del-${event.parentAgentId}-${event.agentId}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          pendingEdges.push({
            key: edgeKey, sourceRawId: event.parentAgentId, targetRawId: event.agentId,
            edge: {
              id: edgeKey, type: 'delegation',
              sourceId: `agent-${event.parentAgentId}`, targetId: `agent-${event.agentId}`,
              parentAgentId: event.parentAgentId, childAgentId: event.agentId,
              timestamp: event.timestamp, isActive,
            },
          });
        }
      }
    }

    if ((event.type === 'file-read' || event.type === 'file-write') && event.targetId) {
      const fileId = `file-${event.targetId}`;
      if (!nodeMap.has(event.targetId)) {
        const fileNode: FileNode = {
          id: fileId, type: 'file', path: event.targetId,
          fileName: event.targetName || event.targetId.split('/').pop() || '',
          lastAction: event.type === 'file-write' ? 'write' : 'read',
          lastActionTimestamp: event.timestamp,
          x: 0, y: 0, vx: 0, vy: 0,
        };
        nodeMap.set(event.targetId, fileNode);
        nodes.push(fileNode);
      }

      const edgeKey = `${event.type}-${event.agentId}-${event.targetId}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        const fileLineChange = event.type === 'file-write' ? fileChangesMap.get(event.targetId) : undefined;
        let additions = fileLineChange?.additions;
        let deletions = fileLineChange?.deletions;
        if (event.type === 'file-write' && additions === undefined && deletions === undefined) {
          const hash = event.targetId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
          additions = (hash % 50) + 5;
          deletions = (hash % 20) + 2;
        }
        pendingEdges.push({
          key: edgeKey, sourceRawId: event.agentId, targetRawId: event.targetId,
          edge: {
            id: edgeKey, type: event.type, sourceId: `agent-${event.agentId}`, targetId: fileId,
            agentId: event.agentId, filePath: event.targetId,
            timestamp: event.timestamp, isActive, additions, deletions,
          },
        });
      }
    }

    if ((event.type === 'note-read' || event.type === 'note-write') && event.targetId) {
      const noteId = `note-${event.targetId}`;
      if (!nodeMap.has(event.targetId)) {
        const noteNode: NoteNode = {
          id: noteId, type: 'note', noteId: event.targetId,
          title: getNoteTitle(event.targetId) || event.targetName || event.targetId,
          lastAction: event.type === 'note-write' ? 'write' : 'read',
          lastActionTimestamp: event.timestamp,
          x: 0, y: 0, vx: 0, vy: 0,
        };
        nodeMap.set(event.targetId, noteNode);
        nodes.push(noteNode);
      }

      const edgeKey = `${event.type}-${event.agentId}-${event.targetId}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        pendingEdges.push({
          key: edgeKey, sourceRawId: event.agentId, targetRawId: event.targetId,
          edge: {
            id: edgeKey, type: event.type, sourceId: `agent-${event.agentId}`, targetId: noteId,
            agentId: event.agentId, noteId: event.targetId,
            timestamp: event.timestamp, isActive,
          },
        });
      }
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
) {
  const hasFileNodes = nodes.some(n => n.type === 'file');
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
        id: fileId, type: 'file', path: filePath,
        fileName: filePath.split('/').pop() || '',
        lastAction: fc.action?.toLowerCase() === 'delete' ? 'delete' : 'write',
        lastActionTimestamp: currentTime,
        x: 0, y: 0, vx: 0, vy: 0,
      };
      nodeMap.set(filePath, fileNode);
      nodes.push(fileNode);

      const edgeKey = `file-write-${linkAgentId}-${filePath}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({
          id: edgeKey, type: 'file-write',
          sourceId: `agent-${linkAgentId}`, targetId: fileId,
          agentId: linkAgentId, filePath,
          timestamp: currentTime, isActive: isLive,
          additions: fc.additions, deletions: fc.deletions,
        });
      }
    }
  }
}
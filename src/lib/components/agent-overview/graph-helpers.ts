/**
 * Graph Helpers
 *
 * Utility functions for building the agent overview graph.
 * Extracted for testability and maintainability.
 */

import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { AgentNode, GraphEdge } from './types';
import { isRecentlyActive } from './activity-motion';
import {
  FILE_EDIT_TOOLS,
  FILE_READ_TOOLS,
  NOTE_TOOLS,
  NOTE_READ_TOOLS,
  TASK_TOOLS,
  TASK_READ_TOOLS,
  DELEGATION_TOOLS,
} from './constants';
import { getLastMeaningfulLine } from '$lib/utils/text-utils';

export type EdgePairDirection = 'a-to-b' | 'b-to-a';

export interface MergedEdgePair {
  key: string;
  aId: string;
  bId: string;
  members: GraphEdge[];
  type: GraphEdge['type'];
  isActive: boolean;
  isRecentlyActive: boolean;
  timestamp: string;
  directions: Set<EdgePairDirection>;
  latestEdge: GraphEdge;
}

const EDGE_TYPE_PRIORITY: Record<GraphEdge['type'], number> = {
  'waiting-on': 7,
  delegation: 6,
  'task-assignment': 5,
  message: 4,
  'file-write': 3,
  'note-write': 3,
  'task-create': 3,
  'task-update': 3,
  'file-read': 2,
  'note-read': 2,
};

function edgeTimestamp(edge: GraphEdge): number {
  const timestamp = Date.parse(edge.timestamp);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function mergeEdgesByPair(edges: GraphEdge[], now = Date.now()): MergedEdgePair[] {
  const pairs = new Map<string, MergedEdgePair>();

  for (const edge of edges) {
    const [aId, bId] = [edge.sourceId, edge.targetId].sort();
    const key = `${aId}|${bId}`;
    const direction: EdgePairDirection = edge.sourceId === aId ? 'a-to-b' : 'b-to-a';
    const existing = pairs.get(key);

    if (!existing) {
      pairs.set(key, {
        key,
        aId,
        bId,
        members: [edge],
        type: edge.type,
        isActive: edge.isActive,
        isRecentlyActive: isRecentlyActive(edge.timestamp, now),
        timestamp: edge.timestamp,
        directions: new Set([direction]),
        latestEdge: edge,
      });
      continue;
    }

    existing.members.push(edge);
    existing.directions.add(direction);
    existing.isActive ||= edge.isActive;
    existing.isRecentlyActive ||= isRecentlyActive(edge.timestamp, now);
    if (EDGE_TYPE_PRIORITY[edge.type] > EDGE_TYPE_PRIORITY[existing.type]) {
      existing.type = edge.type;
    }
    if (edgeTimestamp(edge) >= edgeTimestamp(existing.latestEdge)) {
      existing.latestEdge = edge;
      existing.timestamp = edge.timestamp;
    }
  }

  return [...pairs.values()];
}

// ============================================================================
// Path Classification
// ============================================================================

function normalizePosixPath(value: string): string {
  const isAbsolute = value.startsWith('/');
  const segments: string[] = [];

  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  if (isAbsolute) return `/${segments.join('/')}`;
  return segments.join('/') || '.';
}

export function isExternalFilePath(filePath: string, rootPaths: string[]): boolean {
  const roots = rootPaths.filter(Boolean).map(normalizePosixPath);
  if (roots.length === 0) return false;

  const normalizedPath = normalizePosixPath(filePath);
  if (!filePath.startsWith('/')) {
    return normalizedPath === '..' || normalizedPath.startsWith('../');
  }

  return !roots.some(
    (root) =>
      normalizedPath === root ||
      (root === '/' ? normalizedPath.startsWith('/') : normalizedPath.startsWith(`${root}/`)),
  );
}

// ============================================================================
// Status Mapping
// ============================================================================

/**
 * Convert AgentSession.status (AgentStatus enum) to AgentNode status string.
 * Handles the various flags and enum values to determine the display status.
 */
export function getNodeStatus(
  session: AgentSession | undefined,
  isResponding = false,
): AgentNode['status'] {
  if (!session) return 'idle';

  // Terminal session statuses are authoritative — if the session is marked
  // Completed/Error/Deleted, trust that over any stale streaming/processing
  // flags that may not have been cleared properly.
  if (session.status === AgentStatus.Completed) return 'completed';
  if (session.status === AgentStatus.Error || session.status === AgentStatus.Deleted)
    return 'failed';

  // Check processing flags for responding state
  // These flags indicate the agent is actively working
  if (isResponding || hasActiveResponseFlags(session)) {
    return 'responding';
  }

  // If backend/session status is explicitly idle and no active flags remain, trust
  // that source of truth over stale assistant-message streaming metadata.
  if (isExplicitlyIdleStatus(session.status)) {
    return 'idle';
  }

  // Also check the last assistant message's streaming state.
  // Delegated agents may not have session-level isStreaming/isProcessing set,
  // but their last message will have isStreaming=true or streamingComplete still
  // falsy while they are actively working.
  // Use explicit === false for streamingComplete (undefined means never set, not actively streaming)
  if (session.messages && session.messages.length > 0) {
    const lastAssistantMsg = [...session.messages].reverse().find((m) => m.role === 'assistant');
    if (
      lastAssistantMsg &&
      (lastAssistantMsg.isStreaming || lastAssistantMsg.streamingComplete === false)
    ) {
      return 'responding';
    }
  }

  // Map AgentStatus enum to our node status
  switch (session.status) {
    case AgentStatus.Active:
      return 'idle';
    case AgentStatus.Pending:
    case AgentStatus.Idle:
      return 'idle';
    case AgentStatus.Processing:
      return isResponding ? 'responding' : 'idle';
    case AgentStatus.Waiting:
      return 'waiting';
    default:
      return 'idle';
  }
}

function hasActiveResponseFlags(session: AgentSession): boolean {
  return Boolean(session.isProcessing || session.isStreaming || (session as any).isResponding);
}

function isExplicitlyIdleStatus(status: AgentSession['status'] | string | undefined): boolean {
  return status === AgentStatus.Idle || status === 'idle';
}

// ============================================================================
// Streaming State Extraction
// ============================================================================

export interface StreamingState {
  /** Name of the currently active tool call */
  activeToolName?: string;
  /** Input parameters of the currently active tool call */
  activeToolInput?: Record<string, unknown>;
  /** Last meaningful response line from the agent */
  lastResponse?: string;
}

/**
 * Extract streaming state from an agent session.
 *
 * Preview fields come verbatim from the wire AgentLite fields (PROTOCOL §5.5):
 * `lastAgentResponse` is already server-cleaned by `clean_response_text`
 * (strips `<agent_digest>`, suggested-prompts blocks, group tags) and is
 * push-applied ~1s during a live turn by `agent:stream:activity`; the active
 * tool preview is the wire `lastToolUse` overlay while streaming (cleared at
 * turn boundaries). The transcript is never re-crawled to derive previews
 * (monorepo#2852).
 */
export function getStreamingState(session: AgentSession | undefined): StreamingState {
  const result: StreamingState = {};

  if (!session) return result;

  if (session.lastAgentResponse) {
    const line = getLastMeaningfulLine(session.lastAgentResponse);
    if (line) result.lastResponse = line;
  }

  if (isExplicitlyIdleStatus(session.status) && !hasActiveResponseFlags(session)) {
    return result;
  }

  // Live tool overlay: only trust `lastToolUse` as the ACTIVE tool while the
  // session is streaming — an idle leftover is the persisted preview, not an
  // in-flight call (same gating as getAgentPeekData).
  if (session.isStreaming && session.lastToolUse?.name) {
    result.activeToolName = session.lastToolUse.name;
    result.activeToolInput = (session.lastToolUse.input as Record<string, unknown>) || {};
  }

  return result;
}

// ============================================================================
// Tool Call Extraction Types
// ============================================================================

export interface ExtractedFileChange {
  path: string;
  type: 'create' | 'modify' | 'delete' | 'read';
  timestamp: string;
  additions?: number;
  deletions?: number;
}

export interface ExtractedNoteChange {
  noteId: string;
  title: string;
  action: 'create' | 'write' | 'read';
  timestamp: string;
}

export interface ExtractedTaskChange {
  taskId: string;
  name: string;
  description?: string;
  state?: 'not_started' | 'in_progress' | 'complete' | 'cancelled';
  action: 'create' | 'update' | 'read';
  timestamp: string;
}

interface ToolCallLike {
  name?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

interface ContentBlockLike {
  type: string;
  id?: string;
  name?: string;
  toolName?: string;
  input?: Record<string, unknown>;
}

interface MessageLike {
  timestamp?: string | number | Date;
  toolCalls?: ToolCallLike[];
  contentBlocks?: ContentBlockLike[];
}

// ============================================================================
// Tool Call Processing
// ============================================================================

/**
 * Extract the tool name from a tool call object.
 * Handles different property names used across the codebase.
 */
function getToolName(toolCall: ToolCallLike | ContentBlockLike): string {
  return (toolCall.name || toolCall.toolName || '').toLowerCase();
}

/**
 * Extract arguments from a tool call object.
 * Handles different property names used across the codebase.
 */
function getToolArgs(toolCall: ToolCallLike | ContentBlockLike): Record<string, unknown> {
  if ('input' in toolCall && toolCall.input) {
    return toolCall.input;
  }
  if ('arguments' in toolCall && toolCall.arguments) {
    return toolCall.arguments;
  }
  if ('parameters' in toolCall && toolCall.parameters) {
    return toolCall.parameters;
  }
  return {};
}

/**
 * Check if a tool name is a file editing tool.
 * Handles:
 * - Exact tool names like 'str-replace-editor'
 * - Tool names with suffixes like 'str-replace-editor_workspace-mcp'
 * - Display names like 'Edit `path/to/file.ts`'
 */
function isFileEditTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase();
  // First check exact match
  if (FILE_EDIT_TOOLS.has(toolName)) return true;
  // Then check if it starts with any known file edit tool name
  for (const tool of FILE_EDIT_TOOLS) {
    if (lowerName.startsWith(tool.toLowerCase())) return true;
  }
  // Check for display name patterns like "Edit `path`"
  if (
    lowerName.startsWith('edit ') ||
    lowerName.startsWith('save ') ||
    lowerName.startsWith('create ')
  ) {
    return true;
  }
  return false;
}

/**
 * Check if a tool name is a file read tool.
 * Handles display names like 'Read `path/to/file.ts`'
 */
function isFileReadTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase();
  if (FILE_READ_TOOLS.has(lowerName)) return true;
  for (const tool of FILE_READ_TOOLS) {
    if (lowerName.startsWith(`${tool}_`) || lowerName.startsWith(`${tool}-`)) return true;
  }
  // Check for display name pattern "Read `path`" but not "Read `.`" (directory)
  if (lowerName.startsWith('read `') && !lowerName.includes('read `.`')) {
    return true;
  }
  // Check for view tool
  if (lowerName.startsWith('view') || lowerName === 'view') {
    return true;
  }
  return false;
}

/**
 * Check if a tool name is a note tool.
 * Handles tool name suffixes like '_workspace-mcp' by checking if the name starts with any known tool.
 */
function isNoteTool(toolName: string): boolean {
  // First check exact match
  if (NOTE_TOOLS.has(toolName)) return true;
  // Then check if it starts with any known note tool name
  for (const tool of NOTE_TOOLS) {
    if (toolName.startsWith(tool)) return true;
  }
  return false;
}

/**
 * Determine file action type from tool name.
 */
function getFileActionType(toolName: string): 'create' | 'modify' | 'delete' {
  if (toolName === 'save-file') return 'create';
  if (toolName === 'remove-files') return 'delete';
  return 'modify';
}

/**
 * Determine note action type from tool name.
 */
function getNoteActionType(toolName: string): 'create' | 'write' | 'read' {
  if (toolName === 'create_note') return 'create';
  if (NOTE_READ_TOOLS.has(toolName)) return 'read';
  return 'write';
}

/**
 * Check if a tool name is a task tool.
 */
function isTaskTool(toolName: string): boolean {
  if (TASK_TOOLS.has(toolName)) return true;
  for (const tool of TASK_TOOLS) {
    if (toolName.startsWith(tool)) return true;
  }
  return false;
}

/**
 * Determine task action type from tool name.
 */
function getTaskActionType(toolName: string): 'create' | 'update' | 'read' {
  if (toolName === 'add_tasks') return 'create';
  if (TASK_READ_TOOLS.has(toolName)) return 'read';
  return 'update';
}

/**
 * Check if a path looks like a directory rather than a file.
 * Directories typically don't have file extensions or end with '/'.
 */
function looksLikeDirectory(path: string): boolean {
  // Explicit directory indicators
  if (path === '.' || path === './' || path.endsWith('/')) return true;

  // Get the last segment (file or folder name)
  const lastSegment = path.split('/').pop() || path;

  // If the last segment has no extension (no dot, or only starts with dot like .git),
  // it's likely a directory
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex === -1) return true; // No dot at all = likely directory
  if (dotIndex === 0) return true; // Starts with dot like ".git" = likely directory

  return false;
}

/**
 * Extract file path from a display name like 'Read `path/to/file.ts`' or 'Edit `path`'.
 */
function extractFilePathFromDisplayName(displayName: string): string | null {
  // Match backtick-enclosed path: Read `path` or Edit `path`
  // i18n-ignore (scanner false positive: backticks in regex literal confuse the string tracker)
  const match = displayName.match(/`([^`]+)`/);
  if (match && match[1]) {
    const path = match[1];
    // Skip directories
    if (looksLikeDirectory(path)) return null;
    return path;
  }
  return null;
}

/**
 * Extract file path from tool arguments or display name.
 * @param args - Tool arguments object
 * @param toolName - Optional tool name (may be a display name with embedded path)
 */
function extractFilePath(args: Record<string, unknown>, toolName?: string): string | null {
  // First try to extract from args
  const path = args.path || args.file_path || args.filePath;
  if (typeof path === 'string') {
    // Filter out directories
    if (looksLikeDirectory(path)) return null;
    return path;
  }

  // i18n-ignore (scanner false positive: backtick misparse cascade from the regex above)
  // Then try to extract from display name like "Read `path`"
  if (toolName) {
    return extractFilePathFromDisplayName(toolName);
  }

  return null;
}

/**
 * Extract note ID from tool arguments.
 */
function extractNoteId(args: Record<string, unknown>): string | null {
  const noteId = args.noteId || args.note_id || args.title;
  return typeof noteId === 'string' ? noteId : null;
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Check if a tool is a file-related tool (edit or read).
 */
function isFileTool(toolName: string): boolean {
  return isFileEditTool(toolName) || isFileReadTool(toolName);
}

/**
 * Get file action type - 'read' for read tools, otherwise based on edit tool type.
 */
function getFileAction(toolName: string): 'create' | 'modify' | 'delete' | 'read' {
  if (isFileReadTool(toolName)) return 'read';
  return getFileActionType(toolName);
}

/**
 * Extract file changes from an array of messages.
 * Looks in both toolCalls and contentBlocks for tool_use blocks.
 * Handles both file edits and file reads.
 */
export function extractFileChangesFromMessages(
  messages: MessageLike[],
  defaultTimestamp: string,
): ExtractedFileChange[] {
  const changes: ExtractedFileChange[] = [];
  const seenPaths = new Set<string>();

  for (const message of messages) {
    const timestamp = message.timestamp?.toString() || defaultTimestamp;

    // Process toolCalls array
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        const toolName = getToolName(toolCall);
        if (!isFileTool(toolName)) continue;

        const args = getToolArgs(toolCall);
        const filePath = extractFilePath(args, toolCall.name || toolCall.toolName);
        if (!filePath || seenPaths.has(filePath)) continue;

        seenPaths.add(filePath);
        changes.push({
          path: filePath,
          type: getFileAction(toolName),
          timestamp,
        });
      }
    }

    // Process contentBlocks for tool_use blocks
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type !== 'tool_use') continue;

        const toolName = getToolName(block);
        if (!isFileTool(toolName)) continue;

        const args = getToolArgs(block);
        // Pass the original name (which may be a display name with embedded path)
        const filePath = extractFilePath(args, block.name);
        if (!filePath || seenPaths.has(filePath)) continue;

        seenPaths.add(filePath);
        changes.push({
          path: filePath,
          type: getFileAction(toolName),
          timestamp,
        });
      }
    }
  }

  return changes;
}

/**
 * Extract note changes from an array of messages.
 * Looks in both toolCalls and contentBlocks for tool_use blocks.
 */
export function extractNoteChangesFromMessages(
  messages: MessageLike[],
  defaultTimestamp: string,
): ExtractedNoteChange[] {
  const changes: ExtractedNoteChange[] = [];
  const seenNoteIds = new Set<string>();

  for (const message of messages) {
    const timestamp = message.timestamp?.toString() || defaultTimestamp;

    // Process toolCalls array
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        const toolName = getToolName(toolCall);
        if (!isNoteTool(toolName)) continue;

        const args = getToolArgs(toolCall);
        const noteId = extractNoteId(args);
        if (!noteId || seenNoteIds.has(noteId)) continue;

        seenNoteIds.add(noteId);
        changes.push({
          noteId,
          // Use title if provided, otherwise use noteId (may be readable like 'spec' or a UUID)
          title: (args.title as string) || noteId,
          action: getNoteActionType(toolName),
          timestamp,
        });
      }
    }

    // Process contentBlocks for tool_use blocks
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type !== 'tool_use') continue;

        const toolName = getToolName(block);
        if (!isNoteTool(toolName)) continue;

        const args = getToolArgs(block);
        const noteId = extractNoteId(args);
        if (!noteId || seenNoteIds.has(noteId)) continue;

        seenNoteIds.add(noteId);
        changes.push({
          noteId,
          // Use title if provided, otherwise use noteId (may be readable like 'spec' or a UUID)
          title: (args.title as string) || noteId,
          action: getNoteActionType(toolName),
          timestamp,
        });
      }
    }
  }

  return changes;
}

/**
 * Parse tasks from add_tasks tool arguments.
 * The tasks are in an array format with name, description, etc.
 */
function parseTasksFromArgs(args: Record<string, unknown>): Array<{
  taskId: string;
  name: string;
  description?: string;
  state?: string;
}> {
  const tasks: Array<{ taskId: string; name: string; description?: string; state?: string }> = [];

  // add_tasks has a 'tasks' array
  const tasksArg = args.tasks;
  if (Array.isArray(tasksArg)) {
    for (const task of tasksArg) {
      if (typeof task === 'object' && task !== null) {
        const t = task as Record<string, unknown>;
        const name = t.name as string;
        if (name) {
          tasks.push({
            // Generate a unique ID from the name (since add_tasks doesn't provide IDs)
            // i18n-ignore (scanner false positive: backtick misparse cascade, identifier not user-facing)
            taskId: `task-${name.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
            name,
            description: t.description as string | undefined,
            state: t.state as string | undefined,
          });
        }
      }
    }
  }

  // update_tasks has a 'tasks' array with task_id
  if (Array.isArray(tasksArg)) {
    for (const task of tasksArg) {
      if (typeof task === 'object' && task !== null) {
        const t = task as Record<string, unknown>;
        const taskId = t.task_id as string;
        if (taskId && !tasks.some((existing) => existing.taskId === taskId)) {
          tasks.push({
            taskId,
            name: (t.name as string) || taskId,
            description: t.description as string | undefined,
            state: t.state as string | undefined,
          });
        }
      }
    }
  }

  return tasks;
}

/**
 * Map state string to our normalized state type.
 */
function normalizeTaskState(
  state?: string,
): 'not_started' | 'in_progress' | 'complete' | 'cancelled' {
  if (!state) return 'not_started';
  const lower = state.toLowerCase();
  if (lower === 'complete' || lower === 'completed' || lower === 'done') return 'complete';
  if (lower === 'in_progress' || lower === 'in-progress' || lower === 'started')
    return 'in_progress';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  return 'not_started';
}

/**
 * Extract task changes from an array of messages.
 * Looks in both toolCalls and contentBlocks for task tool_use blocks.
 */
export function extractTaskChangesFromMessages(
  messages: MessageLike[],
  defaultTimestamp: string,
): ExtractedTaskChange[] {
  const changes: ExtractedTaskChange[] = [];
  const seenTaskIds = new Set<string>();

  for (const message of messages) {
    const timestamp = message.timestamp?.toString() || defaultTimestamp;

    // Process toolCalls array
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        const toolName = getToolName(toolCall);
        if (!isTaskTool(toolName)) continue;

        const args = getToolArgs(toolCall);
        const action = getTaskActionType(toolName);

        // Extract tasks from the arguments
        const tasks = parseTasksFromArgs(args);
        for (const task of tasks) {
          if (seenTaskIds.has(task.taskId)) continue;
          seenTaskIds.add(task.taskId);

          changes.push({
            taskId: task.taskId,
            name: task.name,
            description: task.description,
            state: normalizeTaskState(task.state),
            action,
            timestamp,
          });
        }
      }
    }

    // Process contentBlocks for tool_use blocks
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type !== 'tool_use') continue;

        const toolName = getToolName(block);
        if (!isTaskTool(toolName)) continue;

        const args = getToolArgs(block);
        const action = getTaskActionType(toolName);

        // Extract tasks from the arguments
        const tasks = parseTasksFromArgs(args);
        for (const task of tasks) {
          if (seenTaskIds.has(task.taskId)) continue;
          seenTaskIds.add(task.taskId);

          changes.push({
            taskId: task.taskId,
            name: task.name,
            description: task.description,
            state: normalizeTaskState(task.state),
            action,
            timestamp,
          });
        }
      }
    }
  }

  return changes;
}

// ============================================================================
// Delegation Batch Extraction
// ============================================================================

/**
 * Check if a tool name is a delegation tool.
 * Handles tool name suffixes like '_workspace-mcp'.
 */
function isDelegationTool(toolName: string): boolean {
  if (DELEGATION_TOOLS.has(toolName)) return true;
  for (const tool of DELEGATION_TOOLS) {
    if (toolName.startsWith(tool)) return true;
  }
  return false;
}

/**
 * Extract agent ID from a tool result text.
 * Looks for patterns like "Agent ID: agent-xxx" in the result content.
 */
function extractAgentIdFromResultText(text: string): string | null {
  if (!text) return null;
  const match = text.match(/Agent ID:\s*(\S+)/i);
  return match ? match[1] : null;
}

/**
 * Extract a text string from a tool result content field.
 * Handles multiple formats:
 * - string: returned as-is
 * - array of content items: extracts text from { type: 'text', text: '...' } items
 * - object with text property: returns the text
 * - other: returns empty string
 */
function getResultText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item: any) => item && typeof item === 'object' && item.type === 'text' && item.text)
      .map((item: any) => item.text)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return '';
}

/**
 * Extract a map from child agent IDs to delegation batch IDs by scanning
 * a parent agent's messages. Tool calls for delegation tools that appear
 * in the same assistant message/response are assigned the same batch ID.
 *
 * @param messages - The parent agent's messages
 * @param parentAgentId - The parent agent's ID (used to construct batch IDs)
 * @returns Map from child agent ID to batch ID string
 */
export function extractDelegationBatchMap(
  messages: MessageLike[],
  parentAgentId: string,
): Map<string, string> {
  const result = new Map<string, string>();

  // Phase 1: Find delegation tool_use blocks in assistant messages
  // and map their tool call IDs to a batch ID per message
  const toolUseToBatch = new Map<string, string>();
  let batchIndex = 0;

  for (const message of messages) {
    const delegationToolUseIds: string[] = [];

    // Check contentBlocks for tool_use blocks
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type === 'tool_use' && block.name) {
          const toolName = getToolName(block);
          if (isDelegationTool(toolName) && block.id) {
            delegationToolUseIds.push(block.id);
          }
        }
      }
    }

    // Check toolCalls array
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        const toolName = getToolName(toolCall);
        if (isDelegationTool(toolName)) {
          const id = (toolCall as any).id;
          if (id && !delegationToolUseIds.includes(id)) {
            delegationToolUseIds.push(id);
          }
        }
      }
    }

    // If this message had delegation tool calls, assign them a batch
    if (delegationToolUseIds.length > 1) {
      // Only create batches for messages with multiple delegation calls
      // i18n-ignore (scanner false positive: backtick misparse cascade, identifier not user-facing)
      const batchId = `${parentAgentId}-batch-${batchIndex}`;
      for (const toolUseId of delegationToolUseIds) {
        toolUseToBatch.set(toolUseId, batchId);
      }
      batchIndex++;
    }
  }

  // Phase 2: Find tool_result blocks and extract child agent IDs
  for (const message of messages) {
    // Check contentBlocks for tool_result blocks
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      for (const block of message.contentBlocks) {
        if (block.type === 'tool_result' && (block as any).tool_use_id) {
          const toolUseId = (block as any).tool_use_id as string;
          const batchId = toolUseToBatch.get(toolUseId);
          if (batchId) {
            // Extract agent ID from the result — handle string, array, and object formats
            const resultText =
              getResultText((block as any).text) ||
              getResultText((block as any).content) ||
              getResultText((block as any).output);
            const agentId = extractAgentIdFromResultText(resultText);
            if (agentId) {
              result.set(agentId, batchId);
            }
          }
        }
      }
    }

    // Check toolCalls with results
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      for (const toolCall of message.toolCalls) {
        const id = (toolCall as any).id;
        if (!id) continue;
        const batchId = toolUseToBatch.get(id);
        if (!batchId) continue;

        // Try to extract agent ID from toolCall.result
        const tcResult = (toolCall as any).result;
        if (tcResult) {
          const resultText = getResultText(tcResult);
          const agentId = extractAgentIdFromResultText(resultText);
          if (agentId) {
            result.set(agentId, batchId);
          }
        }
      }
    }
  }

  return result;
}

// ============================================================================
// Event Conversion
// ============================================================================

type InteractionEvent = import('./types').InteractionEvent;

interface WorkspaceOperation {
  index: number;
  type: InteractionEvent['type'];
  targetId: string;
}

function collectWorkspaceApiOperations(code: string): WorkspaceOperation[] {
  const operations: WorkspaceOperation[] = [];
  const resourceCalls =
    /\bws\.(note|file)\.(read|add|edit|editLines|setContent|write)\s*\(\s*(['"`])([^'"`]+)\3/g;
  let match: RegExpExecArray | null;
  while ((match = resourceCalls.exec(code))) {
    const [, resource, method, quote, targetId] = match;
    if (quote === '`' && targetId.includes('${')) continue;
    const isRead = method === 'read';
    operations.push({
      index: match.index,
      type: `${resource}-${isRead ? 'read' : 'write'}` as InteractionEvent['type'],
      targetId,
    });
  }

  const directAgentCalls = /\bws\.agent\.(send|sendToTask|watch)\s*\(\s*(['"`])([^'"`]+)\2/g;
  while ((match = directAgentCalls.exec(code))) {
    if (match[2] === '`' && match[3].includes('${')) continue;
    operations.push({
      index: match.index,
      type: match[1] === 'watch' ? 'agent-waiting' : 'agent-message',
      targetId: match[3],
    });
  }

  for (const method of ['delegate', 'create']) {
    const callPattern = new RegExp(`\\bws\\.agent\\.${method}\\s*\\(`, 'g');
    while ((match = callPattern.exec(code))) {
      const callEnd = code.indexOf(');', match.index);
      const call = code.slice(match.index, callEnd === -1 ? code.length : callEnd + 2);
      const targetMatch = call.match(/\btaskNoteId\s*:\s*(['"`])([^'"`]+)\1/);
      if (targetMatch && !(targetMatch[1] === '`' && targetMatch[2].includes('${'))) {
        operations.push({ index: match.index, type: 'delegation', targetId: targetMatch[2] });
      }
    }
  }

  return operations.sort((a, b) => a.index - b.index);
}

function interactionId(eventId: string, suffix: string): string {
  return `${eventId}:${suffix}`;
}

/**
 * Convert a WorkspaceEvent to an InteractionEvent for the agent overview graph.
 * Returns an empty array if the event is not relevant to the graph.
 */
export function convertToInteractionEvent(
  event: {
    id: string;
    timestamp: string;
    type: string;
    actor?: { id?: string; name?: string; type?: string };
    data?: any;
  },
  seenQueueMessageIds: Set<string> = new Set(),
): InteractionEvent[] {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    agentId: event.actor?.id || '',
    agentName: event.actor?.name,
  };

  if (event.type === 'agent:created') {
    const data = event.data as any;
    return [
      {
        ...base,
        type: 'agent-created',
        agentId: data?.agentId || base.agentId,
        agentName: data?.agentName || base.agentName,
        parentAgentId: data?.createdByAgentId,
      },
    ];
  }

  if (event.type === 'agent:idle') {
    const data = event.data as any;
    return [
      {
        ...base,
        type: 'agent-idle',
        agentId: data?.agentId || base.agentId,
        parentAgentId: data?.parentAgentId,
      },
    ];
  }

  if (event.type === 'file:changed' && event.actor?.type === 'agent') {
    const data = event.data as Record<string, unknown>;
    const relativePath = data?.relativePath as string | undefined;
    return [
      {
        ...base,
        type: 'file-write',
        targetId: (data?.path || relativePath) as string | undefined,
        targetName: relativePath?.split('/').pop(),
      },
    ];
  }

  if (event.type?.startsWith('note:') && event.actor?.type === 'agent') {
    const data = event.data as Record<string, unknown>;
    const isRead = event.type === 'note:read';
    return [
      {
        ...base,
        type: isRead ? 'note-read' : 'note-write',
        targetId: data?.noteId as string | undefined,
        targetName: data?.title as string | undefined,
      },
    ];
  }

  if (event.type === 'agent:queue:updated') {
    const data = event.data as Record<string, unknown>;
    const receiverId = typeof data?.agentId === 'string' ? data.agentId : '';
    const queue = Array.isArray(data?.queue) ? data.queue : [];
    const interactions: InteractionEvent[] = [];
    for (const entry of queue) {
      if (!entry || typeof entry !== 'object') continue;
      const message = entry as Record<string, unknown>;
      const messageId = typeof message.id === 'string' ? message.id : '';
      const senderId = typeof message.fromAgentId === 'string' ? message.fromAgentId : '';
      if (!messageId || !senderId || !receiverId || seenQueueMessageIds.has(messageId)) continue;
      seenQueueMessageIds.add(messageId);
      interactions.push({
        ...base,
        id: interactionId(event.id, `queue-${messageId}`),
        type: 'agent-message',
        agentId: senderId,
        targetId: receiverId,
      });
    }
    return interactions;
  }

  if (event.type === 'agent:subscriptions-changed') {
    const data = event.data as Record<string, unknown>;
    const agentId = typeof data?.agentId === 'string' ? data.agentId : base.agentId;
    const waitingForAgentIds = Array.isArray(data?.waitingForAgentIds)
      ? data.waitingForAgentIds.filter((id): id is string => typeof id === 'string')
      : [];
    return waitingForAgentIds.map((targetId, index) => ({
      ...base,
      id: interactionId(event.id, `waiting-${index}`),
      type: 'agent-waiting',
      agentId,
      targetId,
    }));
  }

  if (event.type === 'task:agent-linked') {
    const data = event.data as Record<string, unknown>;
    const link = data?.link as Record<string, unknown> | undefined;
    const agentId = typeof link?.agentId === 'string' ? link.agentId : '';
    const noteId = typeof data?.noteId === 'string' ? data.noteId : '';
    if (!agentId || !noteId) return [];
    return [
      {
        ...base,
        type: 'task-update',
        agentId,
        targetId: noteId,
        targetName: typeof link?.taskText === 'string' ? link.taskText : undefined,
      },
    ];
  }

  if (event.type === 'agent:tool:call') {
    const data = event.data as Record<string, unknown>;
    const toolName = typeof data?.toolName === 'string' ? data.toolName.toLowerCase() : '';
    const input =
      data?.input && typeof data.input === 'object' ? (data.input as Record<string, unknown>) : {};
    const interactions: InteractionEvent[] = [];
    const seen = new Set<string>();
    const pushInteraction = (
      type: InteractionEvent['type'],
      targetId: string,
      deduplicate = true,
    ) => {
      const key = `${type}:${targetId}`;
      if (!targetId || (deduplicate && seen.has(key))) return;
      seen.add(key);
      interactions.push({
        ...base,
        id: interactionId(event.id, `${interactions.length}`),
        type,
        targetId,
        targetName: type.startsWith('file-') ? targetId.split('/').pop() : undefined,
      });
    };

    if (toolName.includes('workspace_api') && typeof input.code === 'string') {
      for (const operation of collectWorkspaceApiOperations(input.code)) {
        pushInteraction(operation.type, operation.targetId, false);
      }
    }

    if (data?.toolKind === 'file') {
      const inputPath = input.path || input.file_path || input.filePath;
      const path =
        typeof inputPath === 'string'
          ? inputPath
          : extractFilePath(input, data.toolName as string | undefined);
      if (path && isFileReadTool(toolName)) pushInteraction('file-read', path);
      if (path && isFileEditTool(toolName)) pushInteraction('file-write', path);
    }

    const filesModified = Array.isArray(data?.filesModified) ? data.filesModified : [];
    for (const path of filesModified) {
      if (typeof path === 'string') pushInteraction('file-write', path);
    }

    return interactions;
  }

  return [];
}

/**
 * Graph Helpers
 *
 * Utility functions for building the agent overview graph.
 * Extracted for testability and maintainability.
 */

import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { AgentNode } from './types';
import {
  FILE_EDIT_TOOLS,
  NOTE_TOOLS,
  NOTE_READ_TOOLS,
  TASK_TOOLS,
  TASK_READ_TOOLS,
  DELEGATION_TOOLS,
} from './constants';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';

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
  if (session.status === AgentStatus.Error || session.status === AgentStatus.Deleted) return 'failed';

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
    if (lastAssistantMsg && (lastAssistantMsg.isStreaming || lastAssistantMsg.streamingComplete === false)) {
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
  /** Truncated streaming text preview */
  streamingText?: string;
  /** Name of the currently active tool call */
  activeToolName?: string;
  /** Input parameters of the currently active tool call */
  activeToolInput?: Record<string, unknown>;
  /** Last meaningful response line from the agent */
  lastResponse?: string;
}

/**
 * Get the last meaningful line from text, skipping empty lines
 */
function getLastMeaningfulLine(text: string): string {
  if (!text) return '';
  // Strip group tags so they don't leak into previews
  const cleaned = text.replace(/<group:[^>]+>|<\/group(?::[^>]+)?>/g, '').trim();
  if (!cleaned) return '';
  const lines = cleaned.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && line.length > 3) {
      // Truncate long lines
      return line.length > 80 ? line.slice(0, 80) + '...' : line;
    }
  }
  return '';
}

/**
 * Extract streaming state from an agent session.
 * Looks at the last message to determine current activity.
 */
export function getStreamingState(session: AgentSession | undefined): StreamingState {
  const result: StreamingState = {};

  if (!session || !session.messages || session.messages.length === 0) {
    return result;
  }

  // Get the last assistant message
  const lastMessage = [...session.messages].reverse().find((m) => m.role === 'assistant');
  if (!lastMessage) return result;

  // Look through content blocks for text content (for lastResponse)
  const contentBlocks = lastMessage.contentBlocks || [];

  // Always try to get the last response text
  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) {
      const text = block.text.trim();
      if (text) {
        // Strip suggested prompts before extracting the last meaningful line
        // Suggested prompts are HTML comments like: <!-- suggested-prompts ... -->
        const { cleanedContent } = parseSuggestedPrompts(text);
        result.lastResponse = getLastMeaningfulLine(cleanedContent);
      }
    }
  }

  if (isExplicitlyIdleStatus(session.status) && !hasActiveResponseFlags(session)) {
    return result;
  }

  // Check if the message is still streaming for active state.
  // Use explicit === false check: undefined means the field was never set (completed message),
  // only false means actively streaming and not yet complete.
  const isStreaming = lastMessage.isStreaming || lastMessage.streamingComplete === false;
  if (!isStreaming) return result;

  for (const block of contentBlocks) {
    // Check for active tool use (no result yet)
    if (block.type === 'tool_use' && block.name) {
      // Check if there's a corresponding tool_result
      const hasResult = contentBlocks.some(
        (b) => b.type === 'tool_result' && b.tool_use_id === block.id,
      );
      if (!hasResult) {
        result.activeToolName = block.name;
        result.activeToolInput = (block.input as Record<string, unknown>) || {};
      }
    }

    // Get streaming text from text blocks
    if (block.type === 'text' && block.text) {
      const text = block.text.trim();
      if (text) {
        // Truncate to ~50 chars for preview
        result.streamingText = text.length > 50 ? text.slice(-50) + '...' : text;
      }
    }
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
export function getToolName(toolCall: ToolCallLike | ContentBlockLike): string {
  return (toolCall.name || toolCall.toolName || '').toLowerCase();
}

/**
 * Extract arguments from a tool call object.
 * Handles different property names used across the codebase.
 */
export function getToolArgs(toolCall: ToolCallLike | ContentBlockLike): Record<string, unknown> {
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
export function isFileEditTool(toolName: string): boolean {
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
export function isFileReadTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase();
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
export function isNoteTool(toolName: string): boolean {
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
export function getFileActionType(toolName: string): 'create' | 'modify' | 'delete' {
  if (toolName === 'save-file') return 'create';
  if (toolName === 'remove-files') return 'delete';
  return 'modify';
}

/**
 * Determine note action type from tool name.
 */
export function getNoteActionType(toolName: string): 'create' | 'write' | 'read' {
  if (toolName === 'create_note') return 'create';
  if (NOTE_READ_TOOLS.has(toolName)) return 'read';
  return 'write';
}

/**
 * Check if a tool name is a task tool.
 */
export function isTaskTool(toolName: string): boolean {
  if (TASK_TOOLS.has(toolName)) return true;
  for (const tool of TASK_TOOLS) {
    if (toolName.startsWith(tool)) return true;
  }
  return false;
}

/**
 * Determine task action type from tool name.
 */
export function getTaskActionType(toolName: string): 'create' | 'update' | 'read' {
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
export function extractFilePathFromDisplayName(displayName: string): string | null {
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
export function extractFilePath(args: Record<string, unknown>, toolName?: string): string | null {
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
export function extractNoteId(args: Record<string, unknown>): string | null {
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
export function isDelegationTool(toolName: string): boolean {
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
            const resultText = getResultText((block as any).text)
              || getResultText((block as any).content)
              || getResultText((block as any).output);
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

/**
 * Convert a WorkspaceEvent to an InteractionEvent for the agent overview graph.
 * Returns null if the event is not relevant to the graph.
 */
export function convertToInteractionEvent(event: {
  id: string;
  timestamp: string;
  type: string;
  actor?: { id?: string; name?: string; type?: string };
  data?: any;
}): import('./types').InteractionEvent | null {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    agentId: event.actor?.id || '',
    agentName: event.actor?.name,
  };

  if (event.type === 'agent:created') {
    const data = event.data as any;
    return {
      ...base, type: 'agent-created',
      agentId: data?.agentId || base.agentId,
      agentName: data?.agentName || base.agentName,
      parentAgentId: data?.createdByAgentId,
    };
  }

  if (event.type === 'agent:idle') {
    const data = event.data as any;
    return {
      ...base, type: 'agent-idle',
      agentId: data?.agentId || base.agentId,
      parentAgentId: data?.parentAgentId,
    };
  }

  if (event.type === 'file:changed' && event.actor?.type === 'agent') {
    const data = event.data as Record<string, unknown>;
    const action = data?.action;
    const isWrite = action === 'create' || action === 'modify' || action === 'delete';
    const relativePath = data?.relativePath as string | undefined;
    return {
      ...base,
      type: isWrite ? 'file-write' : 'file-read',
      targetId: (data?.path || relativePath) as string | undefined,
      targetName: relativePath?.split('/').pop(),
    };
  }

  if (event.type?.startsWith('note:') && event.actor?.type === 'agent') {
    const data = event.data as Record<string, unknown>;
    const isWrite = event.type === 'note:created' || event.type === 'note:updated';
    return {
      ...base,
      type: isWrite ? 'note-write' : 'note-read',
      targetId: data?.noteId as string | undefined,
      targetName: data?.title as string | undefined,
    };
  }

  if (event.type === 'agent:tool:call') {
    const data = event.data as any;
    const toolName = data?.toolName?.toLowerCase() || '';
    if (toolName.includes('read') && data?.filesModified?.[0]) {
      return {
        ...base, type: 'file-read',
        targetId: data.filesModified[0],
        targetName: data.filesModified[0].split('/').pop(),
      };
    }
    if ((toolName.includes('write') || toolName.includes('edit')) && data?.filesModified?.[0]) {
      return {
        ...base, type: 'file-write',
        targetId: data.filesModified[0],
        targetName: data.filesModified[0].split('/').pop(),
      };
    }
  }

  return null;
}
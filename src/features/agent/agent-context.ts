/**
 * Agent Context Types
 *
 * Defines lightweight context references that can be passed to agents.
 * These are pointers to content, not the content itself (except for selections/chunks).
 */

/**
 * Context reference for agent launch
 *
 * References can be:
 * - Pointers (file, spec, note) - agent fetches content via MCP tools
 * - Content (selection, task, code_chunk) - content included directly
 */
export interface ContextReference {
  type: 'file' | 'spec' | 'task' | 'selection' | 'code_chunk' | 'note' | 'terminal';

  // File reference - pointer only
  filePath?: string;
  lineNumber?: number;

  // Content references - include the actual content
  selectedText?: string; // For type: 'selection'
  taskText?: string; // For type: 'task'
  codeChunk?: string; // For type: 'code_chunk'
  terminalContent?: string; // For type: 'terminal' - terminal output buffer

  // Task-specific fields
  taskPosition?: number; // Position of task in document
  taskChecked?: boolean; // Whether task is checked/completed
  taskNode?: any; // Task node data from TipTap

  // Surrounding context - for content that has more around it
  surroundingContext?: {
    before?: string; // Lines/content before
    after?: string; // Lines/content after
    filePath?: string; // Where this content came from
    startLine?: number; // Starting line number
    endLine?: number; // Ending line number
  };

  // Note reference - just the ID
  noteId?: string;

  // Optional metadata for debugging/tracking
  metadata?: Record<string, any>;
}

/**
 * Request to launch an agent with specific agent type and context
 */
export interface AgentLaunchRequest {
  workspaceId: string;
  agentType: string; // Agent type identifier (e.g., 'workspace', 'task-loop', 'debug')
  userMessage?: string; // Optional - not needed when context is sufficient
  references?: ContextReference[];
  agentName?: string; // Optional custom name (auto-generated if not provided)
}

/**
 * Agent context format for IPC communication
 */
export interface AgentContext {
  type: 'file' | 'selection' | 'note' | 'task' | 'spec' | 'code_chunk' | 'terminal';
  path?: string;
  content?: string;
  metadata?: Record<string, any>;
}

/**
 * Convert ContextReference[] to AgentContext[] format
 *
 * @param contextReferences - Array of context references
 * @returns Array of agent contexts
 */
export function convertContextReferences(contextReferences: ContextReference[]): AgentContext[] {
  return contextReferences.map((ref) => ({
    type: ref.type,
    path: ref.filePath,
    content: ref.selectedText || ref.taskText || ref.codeChunk || ref.terminalContent,
    metadata: {
      lineNumber: ref.lineNumber,
      surroundingContext: ref.surroundingContext,
      taskPosition: ref.taskPosition,
      taskChecked: ref.taskChecked,
      noteId: ref.noteId,
      ...ref.metadata, // Preserve additional metadata (e.g., terminalId, terminalName)
    },
  }));
}

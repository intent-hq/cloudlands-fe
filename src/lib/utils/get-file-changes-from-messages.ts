/**
 * Utility to extract file changes from chat messages
 *
 * Analyzes tool_use content blocks in messages to extract file changes
 * made by the agent during the conversation.
 */

import type { AgentMessage, ContentBlock } from '$shared/types';

export interface ChatFileChange {
  filePath: string;
  action: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  toolName: string;
  toolCallId: string;
  /** Content before the change (for diffs) */
  oldContent?: string;
  /** Content after the change (for diffs) */
  newContent?: string;
  /** Starting line number of the change in the original file (1-based) */
  startLineNumber?: number;
  /**
   * Whether the content is full file content (from git:diff) vs snippet content (from tool calls).
   * When true, the diff viewer can safely use git:diff to refresh content on external changes.
   * When false/undefined, the content is a snippet that requires special handling.
   */
  isFullFileContent?: boolean;
}

export interface ChatFileChangeSummary {
  changes: ChatFileChange[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Check if tool result content indicates a tool execution failure
 * This catches cases where is_error flag wasn't explicitly set but the content
 * clearly indicates the tool itself failed to execute (not just returned an error result)
 *
 * We're conservative here to avoid false positives - only match patterns that
 * clearly indicate the tool call itself failed, not that the tool successfully
 * returned an error message about something else.
 */
function isToolResultContentError(content: any): boolean {
  if (!content) return false;

  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  // Only match tool execution failure patterns (case-insensitive)
  // These indicate the tool itself failed to run, not that it ran and found an error
  const toolExecutionFailurePatterns = [
    /tool .* not found/i,
    /tool .* not available/i,
    /unknown tool/i,
    /invalid tool/i,
    /tool execution failed/i,
    /failed to execute tool/i,
    /tool error:/i,
  ];

  return toolExecutionFailurePatterns.some((pattern) => pattern.test(contentStr));
}

/**
 * Build a set of failed tool call IDs from a message
 *
 * Checks multiple sources for failure indicators:
 * 1. toolResults array with isError=true
 * 2. toolCalls array with status='failed' or error property
 * 3. tool_result content blocks with is_error/isError=true
 * 4. tool_result content that looks like an error message
 *
 * Special handling: When a tool_result has is_error=true but an empty tool_use_id,
 * we look at the immediately preceding tool_use block to find the ID.
 */
function getFailedToolIds(message: AgentMessage): Set<string> {
  const failedToolIds = new Set<string>();

  // Check toolResults array
  if (message.toolResults) {
    for (const result of message.toolResults) {
      if ((result.isError || isToolResultContentError(result.content)) && result.toolCallId) {
        failedToolIds.add(result.toolCallId);
      }
    }
  }

  // Check toolCalls array for failed status or error property
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      if (call.status === 'failed' || call.error) {
        if (call.id) failedToolIds.add(call.id);
      }
    }
  }

  // Check tool_result content blocks
  if (message.contentBlocks) {
    const blocks = message.contentBlocks;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'tool_result') {
        const hasErrorFlag = block.is_error || block.isError;
        const hasErrorContent = isToolResultContentError(block.content || block.text);

        if (hasErrorFlag || hasErrorContent) {
          // Try to get the tool_use_id from the block itself
          let toolUseId = block.tool_use_id || block.toolCallId || block.id;

          // If tool_use_id is empty/missing, check if the immediately preceding block
          // is a tool_use and use its ID. This handles cases where the tool_result
          // has is_error=true but empty tool_use_id (common pattern in streaming).
          if (!toolUseId && i > 0) {
            const prevBlock = blocks[i - 1];
            if (prevBlock.type === 'tool_use') {
              toolUseId = prevBlock.id || prevBlock.tool_use_id || prevBlock.toolCallId;
            }
          }

          if (toolUseId) {
            failedToolIds.add(toolUseId);
          }
        }
      }
    }
  }

  return failedToolIds;
}

/**
 * Extract file changes from a single message
 *
 * When multiple tool calls modify the same file within a single message:
 * - oldContent from the FIRST change (original state)
 * - newContent from the LAST change (final state)
 * - Accumulated additions/deletions from all changes
 *
 * NOTE: Failed tool calls (where the corresponding tool_result has is_error=true,
 * or the toolCall has status='failed' or an error property) are excluded from
 * file change tracking since they didn't actually modify files.
 */
export function getFileChangesFromMessage(message: AgentMessage): ChatFileChangeSummary {
  const changesMap = new Map<string, ChatFileChange>();

  if (message.role !== 'assistant' || !message.contentBlocks) {
    return { changes: [], totalFiles: 0, totalAdditions: 0, totalDeletions: 0 };
  }

  // Build a set of failed tool call IDs from all available sources
  const failedToolIds = getFailedToolIds(message);

  for (const block of message.contentBlocks) {
    if (block.type !== 'tool_use') continue;

    // Skip tool calls that failed
    const toolId = block.id || block.tool_use_id || block.toolCallId;
    if (toolId && failedToolIds.has(toolId)) {
      continue;
    }

    const change = extractFileChangeFromBlock(block);
    if (change) {
      // Aggregate changes per file
      const existing = changesMap.get(change.filePath);
      if (existing) {
        // Accumulate additions/deletions
        existing.additions += change.additions;
        existing.deletions += change.deletions;
        existing.action = change.action;
        // Update to latest newContent (final state of file)
        existing.newContent = change.newContent;
        // Update toolCallId to latest change for proper diff viewing
        existing.toolCallId = change.toolCallId;
        existing.toolName = change.toolName;
        // Keep original oldContent (first change's oldContent represents original state)
      } else {
        changesMap.set(change.filePath, { ...change });
      }
    }
  }

  // Filter out no-op changes where oldContent === newContent
  // This can happen if the agent made an edit with identical old_str and new_str
  const changes = Array.from(changesMap.values()).filter((change) => {
    if (change.oldContent !== undefined && change.newContent !== undefined) {
      if (change.oldContent === change.newContent) {
        return false;
      }
    }
    return true;
  });

  return {
    changes,
    totalFiles: changes.length,
    totalAdditions: changes.reduce((sum, c) => sum + c.additions, 0),
    totalDeletions: changes.reduce((sum, c) => sum + c.deletions, 0),
  };
}

/**
 * Extract file changes from an array of chat messages
 *
 * For aggregate views, we track all changes to each file and use:
 * - oldContent from the FIRST change (original state)
 * - newContent from the LAST change (final state)
 * - Accumulated additions/deletions from all changes
 * - Latest toolCallId for the diff viewer
 *
 * NOTE: Failed tool calls are excluded. Since tool_result blocks may appear in
 * a different message (user message) than the tool_use (assistant message),
 * we first collect all failed tool IDs across all messages before processing.
 */
export function getFileChangesFromMessages(messages: AgentMessage[]): ChatFileChangeSummary {
  const changesMap = new Map<string, ChatFileChange>();

  // First pass: collect all failed tool IDs across all messages
  // This handles the case where tool_use is in an assistant message
  // and tool_result (with is_error) is in the following user message
  const allFailedToolIds = new Set<string>();
  for (const message of messages) {
    const failedIds = getFailedToolIds(message);
    for (const id of failedIds) {
      allFailedToolIds.add(id);
    }
  }

  // Second pass: extract file changes, excluding failed tool calls
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.contentBlocks) {
      continue;
    }

    for (const block of message.contentBlocks) {
      if (block.type !== 'tool_use') continue;

      // Skip tool calls that failed
      const toolId = block.id || block.tool_use_id || block.toolCallId;
      if (toolId && allFailedToolIds.has(toolId)) {
        continue;
      }

      const change = extractFileChangeFromBlock(block);
      if (change) {
        const existing = changesMap.get(change.filePath);
        if (existing) {
          // Accumulate additions/deletions
          existing.additions += change.additions;
          existing.deletions += change.deletions;
          existing.action = change.action;
          // Update to latest newContent (final state of file)
          existing.newContent = change.newContent;
          // Update toolCallId to latest change for proper diff viewing
          existing.toolCallId = change.toolCallId;
          existing.toolName = change.toolName;
          // Keep original oldContent (first change's oldContent represents original state)
        } else {
          changesMap.set(change.filePath, { ...change });
        }
      }
    }
  }

  // Filter out no-op changes where oldContent === newContent
  const changes = Array.from(changesMap.values()).filter((change) => {
    if (change.oldContent !== undefined && change.newContent !== undefined) {
      if (change.oldContent === change.newContent) {
        return false;
      }
    }
    return true;
  });

  return {
    changes,
    totalFiles: changes.length,
    totalAdditions: changes.reduce((sum, c) => sum + c.additions, 0),
    totalDeletions: changes.reduce((sum, c) => sum + c.deletions, 0),
  };
}

/**
 * Known note IDs that should be filtered out from file change tracking.
 * These are workspace notes, not files in the codebase.
 */
const KNOWN_NOTE_IDS = new Set(['spec', 'notes', 'tasks', 'readme', 'todo', 'changelog']);

/**
 * Check if a path looks like a workspace note rather than a codebase file.
 * Notes typically:
 * - Are known note IDs (spec, notes, tasks, etc.)
 * - Are under .workspace/notes/
 * - Have no file extension and no path separators
 */
function isNotePath(filePath: string): boolean {
  if (!filePath) return false;

  const normalizedPath = filePath.toLowerCase().trim();

  // Check if it's a known note ID (exact match, case-insensitive)
  if (KNOWN_NOTE_IDS.has(normalizedPath)) {
    return true;
  }

  // Check if it's under .workspace/notes/
  if (normalizedPath.includes('.workspace/notes/')) {
    return true;
  }

  // Check if it's a simple name without extension or path separators
  // that looks like a note ID (e.g., "spec", "tasks")
  // Files typically have extensions or are in subdirectories
  const hasExtension = normalizedPath.includes('.');
  const hasPathSeparator = normalizedPath.includes('/') || normalizedPath.includes('\\');

  // If no extension and no path separator, and it's a simple lowercase word, it's likely a note
  if (!hasExtension && !hasPathSeparator && /^[a-z][a-z0-9-_]*$/.test(normalizedPath)) {
    return true;
  }

  return false;
}

/**
 * Extract file change from a tool_use content block
 */
function extractFileChangeFromBlock(block: ContentBlock): ChatFileChange | null {
  const toolName = block.name || block.toolName || '';
  // Input can be in block.input or block.metadata?.toolInput (from auggie parser)
  const input = block.input || (block.metadata as Record<string, any>)?.toolInput || {};
  const id = block.id || block.tool_use_id || (block.metadata as Record<string, any>)?.toolId || '';
  const toolNameLower = toolName.toLowerCase();

  // Standard tool names
  if (
    toolNameLower === 'str_replace_editor' ||
    toolNameLower === 'str-replace-editor' ||
    toolNameLower.startsWith('edit ')
  ) {
    const change = extractFromStrReplace(id, toolName, input);
    // Filter out note paths - agents should use update_note for notes, not str-replace-editor
    if (change && isNotePath(change.filePath)) {
      return null;
    }
    return change;
  }

  if (
    toolNameLower === 'save_file' ||
    toolNameLower === 'save-file' ||
    toolNameLower === 'write_file' ||
    toolNameLower === 'write-file' ||
    toolNameLower === 'create_file' ||
    toolNameLower === 'create-file' ||
    toolNameLower.startsWith('save ') ||
    toolNameLower.startsWith('create ')
  ) {
    const change = extractFromSaveFile(id, toolName, input);
    // Filter out note paths
    if (change && isNotePath(change.filePath)) {
      return null;
    }
    return change;
  }

  if (toolNameLower === 'remove_files' || toolNameLower === 'remove-files') {
    const change = extractFromRemoveFiles(id, toolName, input);
    // Filter out note paths
    if (change && isNotePath(change.filePath)) {
      return null;
    }
    return change;
  }

  return null;
}

/**
 * Unescape literal \n and \t characters in content from JSON-encoded tool inputs
 */
function unescapeContent(content: string): string {
  if (!content) return content;
  // Replace literal \n with actual newlines and \t with tabs
  // But only if they're escaped (not already actual control characters)
  return content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
}

function extractFromStrReplace(
  id: string,
  toolName: string,
  input: Record<string, any>,
): ChatFileChange | null {
  // Get path from input or extract from tool name like "Edit spec" or "Edit src/foo.ts"
  let path = input.path;
  if (!path && toolName.toLowerCase().startsWith('edit ')) {
    path = toolName.substring(5).trim();
  }
  if (!path) return null;

  // Handle 'create' command: creates a new file with file_text content
  if (input.command === 'create') {
    const rawContent = input.file_text ?? '';
    const content = unescapeContent(rawContent);
    const lines = content ? content.split('\n') : [];

    return {
      filePath: path,
      action: 'create' as const,
      additions: lines.length,
      deletions: 0,
      toolName,
      toolCallId: id,
      oldContent: '',
      newContent: content,
    };
  }

  let additions = 0;
  let deletions = 0;
  const oldParts: string[] = [];
  const newParts: string[] = [];
  let startLineNumber: number | undefined = undefined;

  // Handle nested format: str_replace_entries array
  if (Array.isArray(input.str_replace_entries)) {
    for (const entry of input.str_replace_entries) {
      const rawOldStr = entry.old_str;
      const rawNewStr = entry.new_str;
      const lineNum = entry.old_str_start_line_number;

      if (rawOldStr !== undefined && rawNewStr !== undefined) {
        const oldStr = unescapeContent(rawOldStr as string);
        const newStr = unescapeContent(rawNewStr as string);
        deletions += oldStr.split('\n').length;
        additions += newStr.split('\n').length;
        oldParts.push(oldStr);
        newParts.push(newStr);
        if (startLineNumber === undefined && lineNum !== undefined) {
          startLineNumber = parseInt(lineNum, 10);
        }
      }
    }
  }

  // Handle nested format: insert_entries array
  if (input.command === 'insert' && Array.isArray(input.insert_entries)) {
    for (const entry of input.insert_entries) {
      const rawNewStr = entry.new_str;
      const insertLine = entry.insert_line;

      if (rawNewStr !== undefined) {
        const newStr = unescapeContent(rawNewStr as string);
        additions += newStr.split('\n').length;
        newParts.push(newStr);
        if (startLineNumber === undefined && insertLine !== undefined) {
          startLineNumber = parseInt(insertLine, 10) + 1;
        }
      }
    }
  }

  // Handle flat format: numbered and non-numbered patterns (old_str_1, new_str_1, etc.)
  // Only process if we haven't found entries from nested format
  if (oldParts.length === 0 && newParts.length === 0) {
    for (let i = 1; i <= 10; i++) {
      const rawOldStr = input[`old_str_${i}`] ?? (i === 1 ? input.old_str : undefined);
      const rawNewStr = input[`new_str_${i}`] ?? (i === 1 ? input.new_str : undefined);
      // Capture the start line number from the first replacement
      const lineNum =
        input[`old_str_start_line_number_${i}`] ??
        (i === 1 ? input.old_str_start_line_number : undefined);

      if (rawOldStr !== undefined && rawNewStr !== undefined) {
        // Unescape literal \n characters from JSON encoding
        const oldStr = unescapeContent(rawOldStr as string);
        const newStr = unescapeContent(rawNewStr as string);
        deletions += oldStr.split('\n').length;
        additions += newStr.split('\n').length;
        oldParts.push(oldStr);
        newParts.push(newStr);
        // Use the first start line number we find
        if (startLineNumber === undefined && lineNum !== undefined) {
          startLineNumber = parseInt(lineNum, 10);
        }
      } else if (i > 1) {
        break;
      }
    }

    // Handle flat format insert command
    if (input.command === 'insert') {
      // For insert, the line number is in insert_line_N
      const insertLine = input.insert_line_1 ?? input.insert_line;
      if (insertLine !== undefined && startLineNumber === undefined) {
        startLineNumber = parseInt(insertLine, 10) + 1; // insert_line is 0-based, we want 1-based
      }
      for (let i = 1; i <= 10; i++) {
        const rawNewStr = input[`new_str_${i}`];
        if (rawNewStr !== undefined) {
          const newStr = unescapeContent(rawNewStr as string);
          additions += newStr.split('\n').length;
          newParts.push(newStr);
        } else {
          break;
        }
      }
    }
  }

  // Join multiple replacements with a separator for clarity
  const separator = '\n\n// ─────────────────────────────────────\n\n';

  return {
    filePath: path,
    action: 'modify' as const,
    additions,
    deletions,
    toolName,
    toolCallId: id,
    oldContent: oldParts.join(separator),
    newContent: newParts.join(separator),
    startLineNumber,
  };
}

function extractFromSaveFile(
  id: string,
  toolName: string,
  input: Record<string, any>,
): ChatFileChange | null {
  // Get path from input or extract from tool name like "Save ThemeToggle.svelte" or "Create src/foo.ts"
  let path = input.path || input.file_path || input.filePath;
  const toolNameLower = toolName.toLowerCase();

  if (!path) {
    if (toolNameLower.startsWith('save ')) {
      path = toolName.substring(5).trim();
    } else if (toolNameLower.startsWith('create ')) {
      path = toolName.substring(7).trim();
    }
  }

  // Try multiple possible content field names (tools use different conventions)
  const rawContent =
    input.file_content ??
    input.fileContent ??
    input.content ??
    input.file_text ??
    input.text ??
    input.code ??
    input.body ??
    '';

  // Unescape literal \n characters from JSON encoding
  const content = unescapeContent(rawContent);

  if (!path) return null;

  const lines = content ? content.split('\n') : [];

  return {
    filePath: path,
    action: 'create',
    additions: lines.length || 1, // At least 1 for empty files
    deletions: 0,
    toolName,
    toolCallId: id,
    oldContent: '', // New file, no previous content
    newContent: content,
  };
}

function extractFromRemoveFiles(
  id: string,
  toolName: string,
  input: Record<string, any>,
): ChatFileChange | null {
  const paths = input.file_paths || input.paths || [];
  const firstPath = Array.isArray(paths) ? paths[0] : paths;

  if (!firstPath) return null;

  return {
    filePath: firstPath,
    action: 'delete',
    additions: 0,
    deletions: 1,
    toolName,
    toolCallId: id,
  };
}

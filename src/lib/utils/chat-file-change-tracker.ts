/**
 * Track file changes from agent chat history
 *
 * This utility extracts the actual file changes from tool calls in the chat history,
 * showing only the specific changes made by each tool call, not cumulative changes.
 */

export interface FileChangeFromChat {
  toolCallId: string;
  toolName: string;
  filePath: string;
  action: 'create' | 'modify' | 'delete';
  oldContent: string; // The extracted hunks showing what was changed
  newContent: string; // The extracted hunks showing the new content
  additions: number;
  deletions: number;
  timestamp: string;
}

export interface ToolCallWithFileChange {
  id: string;
  name: string;
  input: any;
  output?: string;
  fileChange?: FileChangeFromChat;
}

/**
 * Extract file changes from tool calls in chat history
 * This analyzes the tool inputs/outputs to determine what changed
 */
export function extractFileChangesFromToolCalls(
  toolCalls: Array<{
    id: string;
    name: string;
    input?: any;
    output?: string;
    phase: 'start' | 'result';
  }>,
): ToolCallWithFileChange[] {
  const result: ToolCallWithFileChange[] = [];

  for (const toolCall of toolCalls) {
    // Only process result phase tool calls
    if (toolCall.phase !== 'result') {
      continue;
    }

    const fileChange = extractFileChangeFromToolCall(toolCall);

    // Skip metadata files (these shouldn't be in workspace anyway)
    if (fileChange?.filePath.includes('.augment/')) {
      continue;
    }

    result.push({
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      output: toolCall.output,
      fileChange,
    });
  }

  return result;
}

/**
 * Extract file change information from a single tool call
 */
function extractFileChangeFromToolCall(toolCall: {
  id: string;
  name: string;
  input?: any;
  output?: string;
}): FileChangeFromChat | undefined {
  const { name, input, output } = toolCall;

  // Handle different file-modifying tools
  switch (name) {
    case 'str_replace_editor':
    case 'str-replace-editor':
      return extractFromStrReplaceEditor(toolCall);

    case 'save_file':
    case 'save-file':
      return extractFromSaveFile(toolCall);

    case 'write_file':
    case 'write-file':
      return extractFromWriteFile(toolCall);

    case 'remove_files':
    case 'remove-files':
      return extractFromRemoveFiles(toolCall);

    default:
      return undefined;
  }
}

/**
 * Extract changes from str_replace_editor tool call
 */
function extractFromStrReplaceEditor(toolCall: {
  id: string;
  name: string;
  input?: any;
  output?: string;
}): FileChangeFromChat | undefined {
  const { input } = toolCall;

  if (!input || !input.path) {
    return undefined;
  }

  const filePath = input.path;
  const command = input.command;

  if (command === 'str_replace') {
    // Extract the old and new strings from the input
    const changes: Array<{
      old: string;
      new: string;
      startLine?: number;
      endLine?: number;
    }> = [];

    // Look for old_str_1, new_str_1, old_str_2, new_str_2, etc.
    for (let i = 1; i <= 10; i++) {
      const oldKey = `old_str_${i}`;
      const newKey = `new_str_${i}`;
      const startKey = `old_str_start_line_number_${i}`;
      const endKey = `old_str_end_line_number_${i}`;

      if (input[oldKey] !== undefined && input[newKey] !== undefined) {
        changes.push({
          old: input[oldKey],
          new: input[newKey],
          startLine: input[startKey],
          endLine: input[endKey],
        });
      } else if (i === 1 && input.old_str !== undefined && input.new_str !== undefined) {
        // Handle case without numbering
        changes.push({
          old: input.old_str,
          new: input.new_str,
          startLine: input.old_str_start_line_number,
          endLine: input.old_str_end_line_number,
        });
        break;
      } else {
        break;
      }
    }

    if (changes.length === 0) {
      return undefined;
    }

    // Build the minimal content showing only what changed
    const oldHunks: string[] = [];
    const newHunks: string[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const oldLines = change.old.split('\n');
      const newLines = change.new.split('\n');

      // Add markers for each change
      if (oldHunks.length > 0) {
        oldHunks.push('...');
        newHunks.push('...');
      }

      // Add line number marker if available
      if (change.startLine) {
        oldHunks.push(`@@ Line ${change.startLine} @@`);
        newHunks.push(`@@ Line ${change.startLine} @@`);
      }

      oldHunks.push(...oldLines);
      newHunks.push(...newLines);

      // Count actual changes (not just line counts)
      const deletions = oldLines.length;
      const additions = newLines.length;
      totalDeletions += deletions;
      totalAdditions += additions;
    }

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      filePath,
      action: 'modify',
      oldContent: oldHunks.join('\n'),
      newContent: newHunks.join('\n'),
      additions: totalAdditions,
      deletions: totalDeletions,
      timestamp: new Date().toISOString(),
    };
  } else if (command === 'insert') {
    // Handle insert command
    const inserts: Array<{ line: number; content: string }> = [];

    // Look for insert_line_1, new_str_1, etc.
    for (let i = 1; i <= 10; i++) {
      const lineKey = `insert_line_${i}`;
      const strKey = `new_str_${i}`;

      if (input[lineKey] !== undefined && input[strKey] !== undefined) {
        inserts.push({
          line: input[lineKey],
          content: input[strKey],
        });
      } else {
        break;
      }
    }

    if (inserts.length === 0) {
      return undefined;
    }

    // For inserts, old content is empty, new content is what was added
    const newLines: string[] = [];
    let additions = 0;

    for (const insert of inserts) {
      if (newLines.length > 0) {
        newLines.push('...');
      }
      newLines.push(`@@ Line ${insert.line} @@`);
      const lines = insert.content.split('\n');
      newLines.push(...lines);
      additions += lines.length;
    }

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      filePath,
      action: 'modify',
      oldContent: '',
      newContent: newLines.join('\n'),
      additions,
      deletions: 0,
      timestamp: new Date().toISOString(),
    };
  }

  return undefined;
}

/**
 * Extract changes from save_file tool call
 */
function extractFromSaveFile(toolCall: {
  id: string;
  name: string;
  input?: any;
  output?: string;
}): FileChangeFromChat | undefined {
  const { input } = toolCall;

  if (!input || !input.path || input.file_content === undefined) {
    return undefined;
  }

  const content = input.file_content;
  const lines = content.split('\n');

  // For new files, show a preview of the content
  let preview: string;
  if (lines.length > 20) {
    preview = [
      ...lines.slice(0, 10),
      '...',
      `... (${lines.length - 20} lines omitted) ...`,
      '...',
      ...lines.slice(-10),
    ].join('\n');
  } else {
    preview = content;
  }

  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    filePath: input.path,
    action: 'create',
    oldContent: '',
    newContent: preview,
    additions: lines.length,
    deletions: 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Extract changes from write_file tool call
 */
function extractFromWriteFile(toolCall: {
  id: string;
  name: string;
  input?: any;
  output?: string;
}): FileChangeFromChat | undefined {
  // Similar to save_file
  return extractFromSaveFile(toolCall);
}

/**
 * Extract changes from remove_files tool call
 */
function extractFromRemoveFiles(toolCall: {
  id: string;
  name: string;
  input?: any;
  output?: string;
}): FileChangeFromChat | undefined {
  const { input } = toolCall;

  if (!input || !input.file_paths) {
    return undefined;
  }

  const filePaths = Array.isArray(input.file_paths) ? input.file_paths : [input.file_paths];

  // For remove, we just track the first file (or could handle multiple)
  if (filePaths.length > 0) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      filePath: filePaths[0],
      action: 'delete',
      oldContent: '[File deleted]',
      newContent: '',
      additions: 0,
      deletions: 1,
      timestamp: new Date().toISOString(),
    };
  }

  return undefined;
}

/**
 * Parse Auggie session files to extract exact file changes
 *
 * Auggie stores complete session history in ~/.augment/sessions/{sessionId}.json
 * These files are updated after the response is fully streamed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { Logger } from '../../shared/logger';
import type {
  AuggieSession,
  ChatExchange,
  ResponseNode,
  ExtractedFileChange,
} from '../../shared/types';

// Re-export types for convenience
export type { AuggieSession, ChatExchange, ResponseNode, ExtractedFileChange };

// Create logger instance
const logger = new Logger('AuggieSessionParser');

/**
 * Get the Auggie sessions directory
 */
function getSessionsDir(): string {
  return path.join(homedir(), '.augment', 'sessions');
}

/**
 * Load a session file by ID
 */
export async function loadSession(sessionId: string): Promise<AuggieSession | null> {
  try {
    const sessionPath = path.join(getSessionsDir(), `${sessionId}.json`);
    const content = await fs.readFile(sessionPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to load session ${sessionId}`, error as Error, { sessionId });
    return null;
  }
}

/**
 * Extract file changes from a session
 */
export function extractFileChangesFromSession(session: AuggieSession): ExtractedFileChange[] {
  const changes: ExtractedFileChange[] = [];

  for (const chat of session.chatHistory) {
    if (!chat.exchange.response_nodes) continue;

    for (const node of chat.exchange.response_nodes) {
      if (node.type === 5 && node.tool_use) {
        const change = extractChangeFromToolUse(
          session.sessionId,
          chat.exchange.request_id,
          node.tool_use,
          chat.finishedAt || new Date().toISOString(),
        );

        if (change) {
          changes.push(change);
        }
      }
    }
  }

  return changes;
}

/**
 * Extract file change from a tool use node
 */
function extractChangeFromToolUse(
  sessionId: string,
  exchangeId: string,
  toolUse: ResponseNode['tool_use'],
  timestamp: string,
): ExtractedFileChange | null {
  if (!toolUse) return null;

  const { tool_name, tool_use_id, input_json } = toolUse;

  // Parse the input JSON
  let input: any;
  try {
    input = JSON.parse(input_json);
  } catch (error) {
    logger.error('Failed to parse tool input', error as Error, {
      toolName: tool_name,
      toolUseId: tool_use_id,
    });
    return null;
  }

  // Handle different file-modifying tools
  switch (tool_name) {
    case 'str-replace-editor':
    case 'str_replace_editor':
      return extractFromStrReplaceEditor(sessionId, exchangeId, tool_use_id, input, timestamp);

    case 'save-file':
    case 'save_file':
      return extractFromSaveFile(sessionId, exchangeId, tool_use_id, input, timestamp);

    default:
      return null;
  }
}

/**
 * Extract changes from str-replace-editor tool
 */
function extractFromStrReplaceEditor(
  sessionId: string,
  exchangeId: string,
  toolUseId: string,
  input: any,
  timestamp: string,
): ExtractedFileChange | null {
  if (!input.path || input.command !== 'str_replace') {
    return null;
  }

  // Collect all replacements
  const replacements: Array<{
    old: string;
    new: string;
    startLine?: number;
    endLine?: number;
  }> = [];

  // Check for numbered replacements (old_str_1, new_str_1, etc.)
  for (let i = 1; i <= 10; i++) {
    const oldKey = `old_str_${i}`;
    const newKey = `new_str_${i}`;
    const startKey = `old_str_start_line_number_${i}`;
    const endKey = `old_str_end_line_number_${i}`;

    if (input[oldKey] && input[newKey]) {
      replacements.push({
        old: input[oldKey],
        new: input[newKey],
        startLine: input[startKey],
        endLine: input[endKey],
      });
    } else if (i === 1 && input.old_str && input.new_str) {
      // Handle single replacement without numbering
      replacements.push({
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

  if (replacements.length === 0) {
    return null;
  }

  // Combine all replacements into old/new content
  const oldParts: string[] = [];
  const newParts: string[] = [];

  for (const replacement of replacements) {
    if (oldParts.length > 0) {
      oldParts.push('...');
      newParts.push('...');
    }

    if (replacement.startLine) {
      oldParts.push(`@@ Line ${replacement.startLine} @@`);
      newParts.push(`@@ Line ${replacement.startLine} @@`);
    }

    oldParts.push(replacement.old);
    newParts.push(replacement.new);
  }

  return {
    sessionId,
    exchangeId,
    toolUseId,
    toolName: 'str-replace-editor',
    filePath: input.path,
    oldContent: oldParts.join('\n'),
    newContent: newParts.join('\n'),
    startLine: replacements[0].startLine,
    endLine: replacements[replacements.length - 1].endLine,
    timestamp,
  };
}

/**
 * Extract changes from save-file tool
 */
function extractFromSaveFile(
  sessionId: string,
  exchangeId: string,
  toolUseId: string,
  input: any,
  timestamp: string,
): ExtractedFileChange | null {
  if (!input.path || input.file_content === undefined) {
    return null;
  }

  const content = input.file_content;
  const lines = content.split('\n');

  // For large files, create a preview
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
    sessionId,
    exchangeId,
    toolUseId,
    toolName: 'save-file',
    filePath: input.path,
    oldContent: '', // New file
    newContent: preview,
    timestamp,
  };
}

/**
 * Extract file changes from an Auggie session by ID
 * This is a convenience function that loads the session and extracts changes
 */
export async function extractFileChangesFromAuggieSession(
  sessionId: string,
): Promise<ExtractedFileChange[]> {
  const session = await loadSession(sessionId);
  if (!session) {
    return [];
  }
  return extractFileChangesFromSession(session);
}

/**
 * Extract file changes from an Auggie session for a specific workspace
 * This filters changes to only include files that belong to the workspace
 */
export async function extractFileChangesForWorkspace(
  sessionId: string,
  workspacePath: string,
): Promise<ExtractedFileChange[]> {
  const session = await loadSession(sessionId);
  if (!session) {
    logger.warn(`Session ${sessionId} not found`, { sessionId, workspacePath });
    return [];
  }

  // Get all changes from the session
  const allChanges = extractFileChangesFromSession(session);

  // Filter changes to only include files in the workspace
  // We need to be careful here - the file paths in the session might be:
  // 1. Relative paths (e.g., "README.md", "src/file.ts")
  // 2. Absolute paths that should start with the workspace path
  const workspaceChanges = allChanges.filter((change) => {
    const filePath = change.filePath;

    // Skip files that are clearly from other locations
    if (path.isAbsolute(filePath)) {
      // If it's an absolute path, it must be within the workspace
      const normalizedFilePath = path.normalize(filePath);
      const normalizedWorkspacePath = path.normalize(workspacePath);

      if (!normalizedFilePath.startsWith(normalizedWorkspacePath)) {
        logger.debug(
          `Filtering out file from different workspace: ${filePath} (not in ${workspacePath})`,
          { filePath, workspacePath },
        );
        return false;
      }
    }

    // For relative paths, we assume they're in the current workspace
    // This is reasonable since Auggie runs in the workspace directory
    return true;
  });

  logger.debug(
    `Filtered ${allChanges.length} changes to ${workspaceChanges.length} for workspace ${workspacePath}`,
    {
      allChangesCount: allChanges.length,
      workspaceChangesCount: workspaceChanges.length,
      workspacePath,
    },
  );

  return workspaceChanges;
}

/**
 * Watch for session file updates
 */
export async function watchSessionFile(
  sessionId: string,
  callback: (changes: ExtractedFileChange[]) => void,
): Promise<() => void> {
  const sessionPath = path.join(getSessionsDir(), `${sessionId}.json`);
  let lastModified = 0;

  const checkForUpdates = async () => {
    try {
      const stats = await fs.stat(sessionPath);
      const modified = stats.mtimeMs;

      if (modified > lastModified) {
        lastModified = modified;
        const session = await loadSession(sessionId);
        if (session) {
          const changes = extractFileChangesFromSession(session);
          if (changes.length > 0) {
            callback(changes);
          }
        }
      }
    } catch (error) {
      // File might not exist yet
    }
  };

  // Check every 2 seconds
  const interval = setInterval(checkForUpdates, 2000);

  // Return cleanup function
  return () => clearInterval(interval);
}

/**
 * Workspace file-operation utility functions.
 *
 * Provides file-tracking helpers used by the agent tool executor and MCP bridge.
 * Tool classes have been consolidated into workspace-js-api-tool.ts.
 */

import { Logger } from '../../../../shared/logger';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';

const logger = new Logger('WorkspaceTools');

// Track file operations for agent provenance
export interface FileOperation {
  path: string;
  operation: 'write' | 'delete';
  timestamp: string;
}

// Store pending file operations per workspace
const pendingFileOperations = new Map<string, FileOperation[]>();

export function trackFileOperation(
  workspaceId: string,
  filePath: string,
  operation: 'write' | 'delete',
) {
  if (!pendingFileOperations.has(workspaceId)) {
    pendingFileOperations.set(workspaceId, []);
  }
  pendingFileOperations.get(workspaceId)!.push({
    path: filePath,
    operation,
    timestamp: new Date().toISOString(),
  });
}

export function getPendingFileOperations(workspaceId: string): FileOperation[] {
  return pendingFileOperations.get(workspaceId) || [];
}

export function clearPendingFileOperations(workspaceId: string) {
  pendingFileOperations.delete(workspaceId);
}

/**
 * Emit agent file change event to trigger immediate UI update in CodeChangesPanel.
 * This is called after agent file operations to make the UI feel snappy.
 */
export function emitAgentFileChange(workspaceId: string, filePath: string) {
  try {
    sendToWorkspaceWindows(workspaceId, 'file-tracking:agent-file-changed', {
      workspaceId,
      filePath,
      source: 'agent',
    });
  } catch (error) {
    logger.warn('Failed to emit agent file change event', { error: (error as Error).message });
  }
}


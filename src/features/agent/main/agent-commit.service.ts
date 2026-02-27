/**
 * Agent Commit Service
 *
 * Shared logic for committing agent changes. Used by:
 * - agent_commit_changes MCP tool (manual commits triggered by user request)
 * - auto-commit event handler (automatic commits on task completion)
 *
 * This service ensures atomic stage + commit operations with proper attribution,
 * preventing race conditions when multiple agents work simultaneously.
 */

import { BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import { gitService } from '../../git/main/git.service';
import { getServiceForWorkspace } from '../../file-tracking/main/file-tracking.ipc';
import { ChangeStage } from '../../file-tracking/types';
import { unifiedEventBus } from '../../events/main/unified-event-bus';
import type { WorkspaceId, Result } from '../../../shared/types';

const logger = new Logger({ category: 'AgentCommitService' });

/**
 * Parameters for committing agent changes
 */
interface CommitAgentChangesParams {
  /** Workspace ID */
  workspaceId: string;
  /** Agent ID - used to filter changes to only those made by this agent */
  agentId: string;
  /** Commit message */
  message: string;
  /** Optional: specific files to commit (defaults to all agent's uncommitted changes) */
  files?: string[];
  /** Optional: linked note ID for trailers (used by auto-commit from task completion) */
  noteId?: string;
}

/**
 * Result of a successful commit
 */
interface CommitResult {
  /** Git commit hash */
  hash: string;
  /** Files that were committed */
  files: string[];
  /** Number of files committed */
  fileCount: number;
}

/**
 * Commit an agent's changes.
 *
 * This function:
 * 1. Gets all unstaged changes attributed to this agent
 * 2. Optionally filters to specific files
 * 3. Stages and commits atomically (gitService handles mutex)
 * 4. Updates file tracking state
 *
 * The git operation mutex in gitService ensures this operation is serialized
 * with other git operations on the same workspace, preventing race conditions.
 */
export async function commitAgentChanges(
  params: CommitAgentChangesParams,
): Promise<Result<CommitResult, string>> {
  const { workspaceId, agentId, message, files: requestedFiles, noteId } = params;

  logger.info('[AGENT-COMMIT] Starting commit', {
    workspaceId,
    agentId,
    noteId,
    hasFileFilter: !!requestedFiles?.length,
  });

  try {
    // Get file tracking service
    const fileTrackingService = await getServiceForWorkspace(workspaceId);
    if (!fileTrackingService) {
      logger.warn('[AGENT-COMMIT] No file tracking service for workspace', { workspaceId });
      return { ok: false, error: 'File tracking service not available for this workspace' };
    }

    // Get all unstaged changes attributed to this agent
    const result = await fileTrackingService.getChanges({
      stage: [ChangeStage.Unstaged],
      agentId,
    });
    let agentChanges = result.changes;

    // Filter to specific files if requested
    if (requestedFiles && requestedFiles.length > 0) {
      agentChanges = agentChanges.filter(
        (c) => requestedFiles.includes(c.file) || requestedFiles.includes(c.relativePath),
      );
    }

    if (agentChanges.length === 0) {
      logger.info('[AGENT-COMMIT] No changes to commit', {
        workspaceId,
        agentId,
        hadFileFilter: !!requestedFiles?.length,
      });
      return { ok: false, error: 'No uncommitted changes found for this agent' };
    }

    const filePaths = agentChanges.map((c) => c.file);
    logger.info('[AGENT-COMMIT] Found changes to commit', {
      workspaceId,
      agentId,
      fileCount: filePaths.length,
      files: filePaths.slice(0, 5), // Log first 5 for debugging
    });

    // Build commit message with git trailers for metadata
    const fullMessage = buildCommitMessage(message, agentId, noteId);

    // Stage files - gitService handles the mutex
    const stageResult = await gitService.stageFiles(workspaceId as WorkspaceId, filePaths);
    if (!stageResult.ok) {
      logger.error('[AGENT-COMMIT] Failed to stage files', {
        workspaceId,
        agentId,
        error: stageResult.error,
      });
      return { ok: false, error: `Failed to stage files: ${stageResult.error}` };
    }

    // Commit with retry support for pre-commit hooks
    // Pass filePaths so retry logic can re-stage the correct files if hooks modify them
    const commitResult = await gitService.commit(workspaceId as WorkspaceId, fullMessage, undefined, {
      filesToStage: filePaths,
    });

    if (!commitResult.ok) {
      logger.error('[AGENT-COMMIT] Failed to commit', {
        workspaceId,
        agentId,
        error: commitResult.error,
      });
      // Still try to sync state even on failure
      await syncFileTrackingState(workspaceId);
      return { ok: false, error: `Failed to commit: ${commitResult.error}` };
    }

    const hash = commitResult.data?.hash || 'unknown';
    logger.info('[AGENT-COMMIT] ✓ Successfully committed', {
      workspaceId,
      agentId,
      hash: hash.slice(0, 8),
      fileCount: filePaths.length,
    });

    // Update file tracking state after successful commit
    await syncFileTrackingState(workspaceId, hash);

    return {
      ok: true,
      data: {
        hash,
        files: filePaths,
        fileCount: filePaths.length,
      },
    };
  } catch (error) {
    logger.error('[AGENT-COMMIT] Error during commit', error as Error, {
      workspaceId,
      agentId,
    });
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Build commit message with git trailers for metadata.
 *
 * Git trailers are key-value pairs at the end of the commit message,
 * following the convention of a blank line then "Key: Value" pairs.
 * This allows tools to extract metadata from commits.
 */
function buildCommitMessage(message: string, agentId: string, noteId?: string): string {
  // Clean up message - remove excessive newlines
  const cleanMessage = message.trim().replace(/\n{3,}/g, '\n\n');

  // Build trailers for metadata
  const trailers: string[] = [];
  trailers.push(`Agent-Id: ${agentId}`);
  if (noteId) {
    trailers.push(`Linked-Note-Id: ${noteId}`);
  }

  // Format: subject line(s), blank line, trailers
  return `${cleanMessage}\n\n${trailers.join('\n')}`;
}

/**
 * Sync file tracking state after a commit.
 *
 * This is critical: without this, TrackedChange entries remain as 'unstaged'
 * even though the files are now committed, causing stale data in the UI.
 */
async function syncFileTrackingState(workspaceId: string, commitHash?: string): Promise<void> {
  try {
    const gitIntegration = global.gitIntegrations?.get(workspaceId);
    if (gitIntegration) {
      // Handle post-commit transition (staged -> committed) if we have a hash
      if (commitHash) {
        await gitIntegration.handlePostCommit(commitHash);
      }
      // Force sync to clear stale entries
      await gitIntegration.syncCurrentState(true);
      logger.debug('[AGENT-COMMIT] File tracking state synced', { workspaceId, commitHash });

      // Explicitly notify renderer to refresh immediately after state sync
      // This bypasses the 800ms+ latency of the .git watcher chain
      // (300ms watcher debounce + 500ms renderer debounce)
      notifyRendererOfCommit(workspaceId);
    } else {
      logger.debug('[AGENT-COMMIT] No git integration for workspace (may be initializing)', {
        workspaceId,
      });
    }
  } catch (error) {
    logger.error('[AGENT-COMMIT] Failed to sync file tracking state', error as Error, {
      workspaceId,
    });
    // Don't throw - the commit succeeded, just log the sync error
  }
}

/**
 * Notify the renderer to refresh git status and file tracking state.
 *
 * This emits events directly to the renderer to force an immediate refresh,
 * bypassing the delayed .git watcher chain that can take 800ms+ to propagate.
 */
function notifyRendererOfCommit(workspaceId: string): void {
  try {
    // Clear git status cache so renderer's IPC request gets fresh data
    gitService.clearStatusCache(workspaceId as WorkspaceId);

    // Emit git:status-changed via unifiedEventBus to refresh gitStore
    // This broadcasts to all renderer windows
    unifiedEventBus.emitDomainEvent('git:status-changed', {
      workspaceId: workspaceId as WorkspaceId,
    });

    // Emit file-tracking:changes-updated directly to renderer windows
    // to refresh fileTrackingStore
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send('file-tracking:changes-updated', {
            workspaceId,
            source: 'agent-commit',
          });
        }
      } catch (err) {
        logger.warn('[AGENT-COMMIT] Failed to notify window', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.debug('[AGENT-COMMIT] Notified renderer of commit', { workspaceId });
  } catch (error) {
    // Non-critical - log and continue
    logger.warn('[AGENT-COMMIT] Failed to notify renderer of commit', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

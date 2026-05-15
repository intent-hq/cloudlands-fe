/**
 * Auto-Commit Service
 *
 * Automatically commits agent changes when an agent's turn ends (agent:idle event).
 *
 * The auto-commit setting is checked at event time, so toggling it mid-turn
 * is respected — whatever the value is when the agent's turn ends is what's used.
 *
 * When the agent has a meaningful task title, it's used as the commit message directly.
 * Otherwise, an AI-generated commit message is produced from the actual diffs using
 * a background LLM request (agent names describe the agent's role, not specific changes).
 *
 * This service uses the shared commitAgentChanges() function from agent-commit.service.ts,
 * which ensures atomic operations and proper attribution tracking.
 */

import { Logger } from '../../../shared/logger';
import { isAutoCommitEnabled } from '../../workspace/main/workspace-settings.service';
import { commitAgentChanges } from './agent-commit.service';
import { getServiceForWorkspace } from '../../file-tracking/main/file-tracking.ipc';
import { ChangeStage } from '../../file-tracking/types';
import type { AgentIdleEvent } from '../../events/types';
import { makeBackgroundRequest } from './background-request.service';
import { gitService } from '../../git/main/git.service';
import { shouldSkipFileForAI } from '../../../shared/binary-file-extensions';
import COMMIT_MESSAGE_INSTRUCTION from '../instructions/background/commit-message';
import type { DiffChunk, WorkspaceId } from '../../../shared/types';
import {
  AgentId as createAgentId,
  WorkspaceId as createWorkspaceId,
} from '$shared/types/branded-ids';
import { LineType } from '../../../shared/types';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  gitAutoCommitStarted,
  gitAutoCommitSucceeded,
  gitAutoCommitHookFailure,
} from '../../../store/main/slices/git-events/git-events-slice';
import {
  isRandomAgentName,
  isGenericAgentName,
} from '../../../lib/utils/agent-name-generator';
import { backgroundGitOpsService } from '../../git/main/background-git-ops.service';

const logger = new Logger({ category: 'AutoCommitService' });

/** Max diff size per file (50KB) — matches the limit used in BackgroundAgentExecutor */
const MAX_DIFF_SIZE_PER_FILE = 50_000;
/** Max total diff size (200KB) — keeps the LLM prompt manageable */
const MAX_TOTAL_DIFF_SIZE = 200_000;
/** Timeout for AI commit message generation (15s — shorter than default 30s) */
const AI_COMMIT_MESSAGE_TIMEOUT_MS = 15_000;

/** Max number of times to wake an agent to fix pre-commit hook failures before giving up */
const MAX_HOOK_FIX_RETRIES = 2;
/** TTL for retry tracking entries (5 minutes) — resets if the agent is idle for a long time */
const RETRY_TRACKING_TTL_MS = 5 * 60 * 1000;
/** Prefix in error strings from git.service.ts indicating a pre-commit hook failure */
const PRE_COMMIT_HOOK_ERROR_PREFIX = 'Pre-commit hooks failed:';

/**
 * Track retry attempts per agent for pre-commit hook failures.
 * Prevents infinite loops: agent fixes → idle → auto-commit → hooks fail → wake agent → repeat.
 * Entries are cleared on successful commit or after TTL.
 */
const hookFixRetries = new Map<string, { count: number; lastAttempt: number }>();

/**
 * Per-agent auto-commit status history.
 * Stores all auto-commit results for each agent as an ordered list so the renderer
 * can display them anchored to the correct turn (domain events are ephemeral and
 * missed if the component isn't mounted yet).
 *
 * Each entry corresponds to one auto-commit attempt (one agent:idle → commit cycle).
 * The renderer renders one AutoCommitStatus per turn and matches by index.
 */
export type AutoCommitStatusData =
  | { state: 'committing'; agentName?: string }
  | { state: 'committed'; hash: string; message: string; fileCount: number; agentName?: string }
  | { state: 'hook-failure'; status: 'waking-agent' | 'retries-exhausted'; retryCount: number; agentName?: string };

const autoCommitHistory = new Map<string, AutoCommitStatusData[]>();

/**
 * Get all auto-commit statuses for a given agent.
 * Called by the IPC handler so the renderer can query on mount.
 */
export function getAutoCommitStatuses(agentId: string): AutoCommitStatusData[] {
  return autoCommitHistory.get(agentId) ?? [];
}

/** Append a new status entry for an agent */
function pushAutoCommitStatus(agentId: string, status: AutoCommitStatusData): void {
  const list = autoCommitHistory.get(agentId) ?? [];
  list.push(status);
  autoCommitHistory.set(agentId, list);
}

/** Update the last status entry for an agent (e.g. committing → committed) */
function updateLastAutoCommitStatus(agentId: string, status: AutoCommitStatusData): void {
  const list = autoCommitHistory.get(agentId) ?? [];
  if (list.length > 0) {
    list[list.length - 1] = status;
  } else {
    list.push(status);
  }
  autoCommitHistory.set(agentId, list);
}

/**
 * Check if a commit error is a pre-commit hook failure.
 * The error string from commitAgentChanges wraps the git.service error as:
 *   "Failed to commit: Pre-commit hooks failed: <hook output>"
 */
export function isPreCommitHookFailure(error: string): boolean {
  return error.includes(PRE_COMMIT_HOOK_ERROR_PREFIX);
}

/**
 * Extract the hook output from the error string for display to the agent.
 */
export function extractHookOutput(error: string): string {
  const prefix = 'Failed to commit: ';
  const idx = error.indexOf(prefix);
  return idx >= 0 ? error.substring(idx + prefix.length) : error;
}

/**
 * Get the current retry count for an agent, respecting TTL.
 */
function getRetryCount(agentId: string): number {
  const entry = hookFixRetries.get(agentId);
  if (!entry) return 0;
  if (Date.now() - entry.lastAttempt > RETRY_TRACKING_TTL_MS) {
    hookFixRetries.delete(agentId);
    return 0;
  }
  return entry.count;
}

/**
 * Increment the retry count for an agent.
 */
function incrementRetryCount(agentId: string): number {
  const current = getRetryCount(agentId);
  const newCount = current + 1;
  hookFixRetries.set(agentId, { count: newCount, lastAttempt: Date.now() });
  return newCount;
}

/**
 * Clear retry tracking for an agent (called on successful commit).
 */
export function clearRetryCount(agentId: string): void {
  hookFixRetries.delete(agentId);
}

/**
 * Wake the original agent to fix pre-commit hook failures.
 * Uses sendBackendInitiatedMessage to send a message to the agent with
 * the hook error output and instructions to fix the issues.
 */
async function wakeAgentToFixHooks({
  workspaceId,
  agentId,
  agentName,
  hookOutput,
  retryCount,
}: {
  workspaceId: string;
  agentId: string;
  agentName?: string;
  hookOutput: string;
  retryCount: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { AgentBackendHandler } = await import('./agent-backend-handler.service');
    const handler = AgentBackendHandler.getInstance();

    const message =
      `Your recent changes failed pre-commit hooks when auto-commit tried to commit them.\n\n` +
      `**Pre-commit hook output:**\n\`\`\`\n${hookOutput}\n\`\`\`\n\n` +
      `Please fix the issues so the changes can be committed. ` +
      (retryCount > 1
        ? `This is attempt ${retryCount} — the previous fix didn't resolve all issues.`
        : `Once you're done, auto-commit will try again.`);

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      workspaceId,
      message,
      messageMetadata: {
        type: 'auto_commit_hook_failure',
        hookOutput,
        retryCount,
      },
    });

    logger.info('[AUTO-COMMIT] Woke agent to fix pre-commit hook failures', {
      workspaceId,
      agentId,
      agentName,
      retryCount,
      success: result.success,
      error: result.error,
    });

    return result;
  } catch (error) {
    logger.error('[AUTO-COMMIT] Failed to wake agent for hook fixes', {
      workspaceId,
      agentId,
      error: (error as Error).message,
    });
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Format DiffChunk[] into a human-readable unified diff string.
 * Handles both capitalized ('Addition', 'Deletion', 'Context') and
 * lowercase ('add', 'remove', 'context') line type formats.
 */
function formatDiffChunks(chunks: DiffChunk[]): string {
  let result = '';
  for (const fileChunk of chunks) {
    if (fileChunk.isBinary || fileChunk.isTooLarge) continue;
    if (fileChunk.file) {
      result += `diff --git a/${fileChunk.file} b/${fileChunk.file}\n`;
    }
    if (fileChunk.chunks) {
      for (const hunk of fileChunk.chunks) {
        if (hunk.oldStart !== undefined && hunk.newStart !== undefined) {
          result += `@@ -${hunk.oldStart},${hunk.oldLines || 0} +${hunk.newStart},${hunk.newLines || 0} @@\n`;
        }
        if (hunk.lines) {
          for (const line of hunk.lines) {
            let prefix = ' ';
            if (line.type === LineType.Addition || (line.type as string) === 'add') prefix = '+';
            else if (line.type === LineType.Deletion || (line.type as string) === 'remove') prefix = '-';
            result += `${prefix}${line.content || ''}\n`;
          }
        }
      }
    }
  }
  return result;
}

/**
 * Determine whether a commit message should be AI-generated.
 *
 * Always returns true — we always want to try AI generation for proper
 * conventional commit messages (e.g., "feat: add exclamation mark to README").
 * Task titles and agent names describe intent, not the specific changes made,
 * so they're used as fallbacks only when AI generation fails.
 */
function needsAICommitMessage(): boolean {
  return true;
}

/**
 * Generate an AI commit message from file diffs using a background LLM request.
 *
 * Fetches unstaged diffs for the given file paths, formats them into a prompt,
 * and sends it to a cheap model (Haiku) with the commit-message instruction.
 * Returns the extracted commit message or the fallback on any failure.
 *
 * @param workspaceId - The workspace to get diffs from
 * @param filePaths - Relative paths of changed files
 * @param fallbackMessage - Message to return if generation fails
 */
export async function generateCommitMessage({
  workspaceId,
  filePaths,
  fallbackMessage,
  workingDirectory,
}: {
  workspaceId: string;
  filePaths: string[];
  fallbackMessage: string;
  workingDirectory?: string;
}): Promise<string> {
  try {
    // Filter out binary/lock/minified files
    const filesToDiff: string[] = [];
    const skippedFiles: Array<{ path: string; reason: string }> = [];

    for (const filePath of filePaths) {
      const skipCheck = shouldSkipFileForAI(filePath);
      if (skipCheck.skip) {
        skippedFiles.push({ path: filePath, reason: skipCheck.reason || 'skipped' });
      } else {
        filesToDiff.push(filePath);
      }
    }

    if (filesToDiff.length === 0) {
      logger.info('[AUTO-COMMIT] All files skipped for AI, using fallback message');
      return fallbackMessage;
    }

    // Get diffs from git service (unstaged, since these haven't been staged yet)
    const diffResult = await gitService.getDiff(
      workspaceId as WorkspaceId,
      filesToDiff,
      false, // unstaged
    );

    if (!diffResult.ok || !diffResult.data || diffResult.data.length === 0) {
      logger.info('[AUTO-COMMIT] No diff data available, using fallback message');
      return fallbackMessage;
    }

    // Format diffs with per-file and total size limits
    let combinedDiff = '';
    let totalDiffSize = 0;

    for (const chunk of diffResult.data) {
      if (totalDiffSize >= MAX_TOTAL_DIFF_SIZE) break;

      const fileDiff = formatDiffChunks([chunk]);
      if (fileDiff.length > MAX_DIFF_SIZE_PER_FILE) {
        const truncated = fileDiff.substring(0, MAX_DIFF_SIZE_PER_FILE);
        const lastNewline = truncated.lastIndexOf('\n');
        combinedDiff +=
          truncated.substring(0, lastNewline > 0 ? lastNewline : MAX_DIFF_SIZE_PER_FILE) +
          `\n... [truncated - ${Math.round(fileDiff.length / 1024)}KB]\n\n`;
        totalDiffSize += MAX_DIFF_SIZE_PER_FILE;
      } else if (fileDiff) {
        combinedDiff += fileDiff + '\n';
        totalDiffSize += fileDiff.length;
      }
    }

    if (!combinedDiff.trim()) {
      logger.info('[AUTO-COMMIT] Empty diff after formatting, using fallback message');
      return fallbackMessage;
    }

    // Fetch recent commit messages for style matching
    let recentCommitsSection = '';
    try {
      const historyResult = await gitService.getHistory(workspaceId as WorkspaceId, 5);
      if (historyResult.ok && historyResult.data?.commits?.length) {
        const messages = historyResult.data.commits
          .map((c) => c.message)
          .filter(Boolean)
          .slice(0, 3);
        if (messages.length > 0) {
          recentCommitsSection = '\n## Recent commit messages for style reference:\n';
          for (const msg of messages) {
            recentCommitsSection += `- ${msg}\n`;
          }
        }
      }
    } catch {
      // Not critical
    }

    // Build the prompt
    const prompt = `Generate a commit message for the following changes.

Files changed (${filePaths.length}):
${filePaths.map((f) => `- ${f}`).join('\n')}
${skippedFiles.length > 0 ? `\nSkipped files (binary/lock): ${skippedFiles.map((f) => f.path).join(', ')}\n` : ''}${recentCommitsSection}
## Diff:
\`\`\`diff
${combinedDiff}
\`\`\`
`;

    logger.info('[AUTO-COMMIT] Generating AI commit message', {
      workspaceId,
      fileCount: filePaths.length,
      diffSize: combinedDiff.length,
    });

    const result = await makeBackgroundRequest({
      prompt,
      systemPrompt: COMMIT_MESSAGE_INSTRUCTION,
      timeoutMs: AI_COMMIT_MESSAGE_TIMEOUT_MS,
      workingDirectory,
      agentType: 'commit-message',
    });

    if (!result.success || !result.content) {
      logger.info('[AUTO-COMMIT] AI generation failed, using fallback', {
        error: result.error,
      });
      return fallbackMessage;
    }

    // Extract message from <<<COMMIT_MESSAGE>>> tags
    const tagMatch = result.content.match(
      /<<<COMMIT_MESSAGE>>>\s*([\s\S]*?)\s*<<<\/COMMIT_MESSAGE>>>/,
    );
    const generated = tagMatch?.[1]?.trim();

    if (!generated) {
      logger.info('[AUTO-COMMIT] Could not extract commit message from AI response, using fallback');
      return fallbackMessage;
    }

    // Truncate subject line to 72 chars (take first line only for subject)
    const firstLine = generated.split('\n')[0].trim().substring(0, 72);
    logger.info('[AUTO-COMMIT] AI commit message generated', { message: firstLine });
    return firstLine;
  } catch (error) {
    logger.warn('[AUTO-COMMIT] AI commit message generation error, using fallback', {
      error: (error as Error).message,
    });
    return fallbackMessage;
  }
}


/**
 * Handle agent:idle event for auto-commit
 *
 * This is the PRIMARY auto-commit trigger. It fires at the end of every agent turn,
 * ensuring that any agent that made changes gets those changes committed.
 *
 * The auto-commit setting is checked at event time, so the user can toggle it
 * mid-turn and the value at turn-end is what's respected.
 */
export async function handleAgentIdleAutoCommit(event: AgentIdleEvent): Promise<void> {
  const { workspaceId, data } = event;
  const { agentId, agentName, taskNoteId, taskTitle, finishReason } = data;

  logger.info('[AUTO-COMMIT] Agent idle, checking for auto-commit', {
    workspaceId,
    agentId,
    agentName,
    taskTitle,
    finishReason,
  });

  // Check if auto-commit is enabled for this workspace at the time the turn ends
  // This respects mid-turn toggles by the user
  if (!isAutoCommitEnabled(workspaceId)) {
    logger.info('[AUTO-COMMIT] Auto-commit disabled for workspace, skipping', { workspaceId });
    return;
  }

  // Agent ID is required
  if (!agentId) {
    logger.info('[AUTO-COMMIT] No agent ID on idle event, skipping', { workspaceId });
    return;
  }

  // Skip agents that errored, were interrupted, or whose provider was force-stopped.
  // - error/cancelled: changes may be incomplete
  // - provider_stopped: workspace is being deleted, committing is pointless and could error
  if (finishReason === 'error' || finishReason === 'cancelled' || finishReason === 'provider_stopped') {
    logger.info('[AUTO-COMMIT] Agent finished with non-normal reason, skipping auto-commit', {
      workspaceId,
      agentId,
      finishReason,
    });
    return;
  }

  // Force a git status refresh so that all agent file writes are reflected
  // in the tracking state before we check for changes.
  try {
    const gitIntegration = global.gitIntegrations?.get(workspaceId);
    if (gitIntegration) {
      await gitIntegration.syncCurrentState(true);
      logger.debug('[AUTO-COMMIT] Forced git status sync before change check', {
        workspaceId,
        agentId,
      });
    } else {
      logger.debug('[AUTO-COMMIT] No git integration found, proceeding without sync', {
        workspaceId,
        agentId,
      });
    }
  } catch (error) {
    // If sync fails, fall through — the commit may still work if tracking is already up to date
    logger.warn('[AUTO-COMMIT] Git status sync failed, proceeding with existing state', {
      workspaceId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Early check: does this agent have any unstaged changes?
  // This is a cheap in-memory filter that avoids the more expensive agent persistence
  // load and full commit flow for agents that only chatted without making file changes.
  // We also capture the file paths here for potential AI commit message generation.
  let changedFilePaths: string[] = [];
  try {
    const fileTrackingService = await getServiceForWorkspace(workspaceId);
    if (fileTrackingService) {
      const result = await fileTrackingService.getChanges({
        stage: [ChangeStage.Unstaged],
        agentId,
      });
      if (result.changes.length === 0) {
        logger.debug('[AUTO-COMMIT] No unstaged changes for agent, skipping', {
          workspaceId,
          agentId,
        });
        return;
      }
      changedFilePaths = result.changes
        .map((c) => c.relativePath || c.file)
        .filter(Boolean);
    }
  } catch (error) {
    // If the check fails, fall through to the full commit flow which has its own error handling
    logger.debug('[AUTO-COMMIT] Early change check failed, proceeding with full flow', {
      workspaceId,
      agentId,
      error: (error as Error).message,
    });
  }

  // Check if this agent has skipAutoCommit set in its metadata.
  // Also grab the current agent name from persistence — the name in the event
  // may be stale if the agent renamed itself during its turn.
  let currentAgentName = agentName;
  try {
    const { agentPersistence } = await import('./agent-persistence');

    const loadResult = await agentPersistence.loadAgent(
      createAgentId(agentId),
      createWorkspaceId(workspaceId),
    );

    if (loadResult.success && loadResult.data) {
      if (loadResult.data.name) {
        currentAgentName = loadResult.data.name;
      }
      if (loadResult.data.metadata?.skipAutoCommit) {
        logger.info('[AUTO-COMMIT] Agent has skipAutoCommit metadata set, skipping', {
          workspaceId,
          agentId,
        });
        return;
      }
    }
  } catch (error) {
    // If we can't load the agent, continue with auto-commit
    logger.warn('[AUTO-COMMIT] Could not load agent to check skipAutoCommit metadata', {
      workspaceId,
      agentId,
      error: (error as Error).message,
    });
  }

  // Build commit message.
  // When we have a meaningful task title, use it directly.
  // Otherwise, generate a proper commit message from the actual diffs.
  // Use agent name as fallback only if it was intentionally set (not a random "Adjective Animal" default)
  const isRenamedAgent = currentAgentName && !isRandomAgentName(currentAgentName) && !isGenericAgentName(currentAgentName);
  const fallbackMessage = (taskTitle || (isRenamedAgent ? currentAgentName : undefined) || 'Agent changes')
    .trim()
    .replace(/\n/g, ' ')
    .substring(0, 72);

  // Resolve workspace path for background request so auggie runs in a real directory
  let workspacePath: string | undefined;
  try {
    const { workspaceService } = await import('../../workspace/main/workspace.service');
    const wsResult = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
    if (wsResult.ok) {
      workspacePath = wsResult.data.worktreePath || wsResult.data.repositoryPath || wsResult.data.path;
    }
  } catch (error) {
    logger.warn('[AUTO-COMMIT] Could not resolve workspace path for background request', { error: (error as Error).message });
  }

  let message = fallbackMessage;
  if (needsAICommitMessage() && changedFilePaths.length > 0) {
    message = await generateCommitMessage({
      workspaceId,
      filePaths: changedFilePaths,
      fallbackMessage,
      workingDirectory: workspacePath,
    });
  }

  // Append new status entry (start of a new auto-commit attempt) + emit domain event for UI
  pushAutoCommitStatus(agentId, { state: 'committing', agentName: currentAgentName });
  mainDispatch(gitAutoCommitStarted({
    workspaceId: workspaceId as WorkspaceId,
    agentId,
    agentName: currentAgentName,
  }));

  // Register background git operation so it survives workspace navigation
  const operationId = backgroundGitOpsService.registerOperation(
    workspaceId as WorkspaceId,
    'auto-commit',
    {
      agentId,
      agentName: currentAgentName,
      message,
    },
  );

  // Use shared commit logic - wrap in try/catch to handle unexpected throws
  // If commitAgentChanges throws, we need to fail the operation so it doesn't stay stuck in 'started'
  try {
    const result = await commitAgentChanges({
      workspaceId,
      agentId,
      message,
      noteId: taskNoteId,
    });

    if (result.ok) {
      // Clear any hook-fix retry tracking on success
      clearRetryCount(agentId);

      // Update current attempt status (committing → committed) + emit domain event for UI
      updateLastAutoCommitStatus(agentId, {
        state: 'committed',
        hash: result.data.hash,
        message,
        fileCount: result.data.fileCount,
        agentName: currentAgentName,
      });
      mainDispatch(gitAutoCommitSucceeded({
        workspaceId: workspaceId as WorkspaceId,
        agentId,
        agentName: currentAgentName,
        hash: result.data.hash,
        message,
        fileCount: result.data.fileCount,
      }));

      // Mark background operation as completed
      backgroundGitOpsService.completeOperation(operationId, {
        commitHash: result.data.hash,
        fileCount: result.data.fileCount,
      });

      logger.info('[AUTO-COMMIT] ✓ Successfully auto-committed agent changes on idle', {
        workspaceId,
        agentId,
        agentName: currentAgentName,
        hash: result.data.hash.slice(0, 8),
        fileCount: result.data.fileCount,
      });
      return;
    }

    // Check if this is a pre-commit hook failure — if so, try to wake the agent to fix it
    if (result.error && isPreCommitHookFailure(result.error)) {
      const retryCount = incrementRetryCount(agentId);
      const hookOutput = extractHookOutput(result.error);

      if (retryCount <= MAX_HOOK_FIX_RETRIES) {
        logger.info('[AUTO-COMMIT] Pre-commit hooks failed, waking agent to fix', {
          workspaceId,
          agentId,
          agentName: currentAgentName,
          retryCount,
          maxRetries: MAX_HOOK_FIX_RETRIES,
        });

        // Update current attempt status (committing → hook-failure) + notify UI
        updateLastAutoCommitStatus(agentId, { state: 'hook-failure', status: 'waking-agent', retryCount, agentName: currentAgentName });
        mainDispatch(gitAutoCommitHookFailure({
          workspaceId: workspaceId as WorkspaceId,
          agentId,
          agentName: currentAgentName,
          status: 'waking-agent',
          hookOutput,
          retryCount,
        }));

        // Update background operation progress - agent being woken to fix hooks
        backgroundGitOpsService.updateProgress(
          operationId,
          `Pre-commit hooks failed, waking agent to fix (attempt ${retryCount}/${MAX_HOOK_FIX_RETRIES})`,
        );

        const wakeResult = await wakeAgentToFixHooks({
          workspaceId,
          agentId,
          agentName: currentAgentName,
          hookOutput,
          retryCount,
        });

        if (!wakeResult.success) {
          logger.error('[AUTO-COMMIT] Failed to wake agent for hook fixes, giving up', {
            workspaceId,
            agentId,
            error: wakeResult.error,
          });
          backgroundGitOpsService.failOperation(
            operationId,
            'Failed to wake agent for hook fixes',
          );
        } else {
          // Agent woken successfully - fail this operation so it doesn't leak.
          // The next auto-commit cycle will create a fresh operation if the agent succeeds.
          backgroundGitOpsService.failOperation(
            operationId,
            `Pre-commit hooks failed, agent woken to retry (attempt ${retryCount}/${MAX_HOOK_FIX_RETRIES})`,
          );
        }
        return;
      }

      // Max retries exhausted — give up and notify user
      logger.warn('[AUTO-COMMIT] Pre-commit hook failures exhausted retries, notifying user', {
        workspaceId,
        agentId,
        agentName: currentAgentName,
        retryCount,
      });

      clearRetryCount(agentId);

      // Update current attempt status (committing → hook-failure) + notify UI
      updateLastAutoCommitStatus(agentId, { state: 'hook-failure', status: 'retries-exhausted', retryCount, agentName: currentAgentName });
      mainDispatch(gitAutoCommitHookFailure({
        workspaceId: workspaceId as WorkspaceId,
        agentId,
        agentName: currentAgentName,
        status: 'retries-exhausted',
        hookOutput,
        retryCount,
      }));

      // Mark background operation as failed - retries exhausted
      backgroundGitOpsService.failOperation(
        operationId,
        `Pre-commit hooks failed after ${retryCount} retries`,
      );
      return;
    }

    // Differentiate between "no changes" (expected) and real failures
    const isNoChanges = result.error === 'No uncommitted changes found for this agent';

    if (isNoChanges) {
      // No changes to commit — this is not a failure, just nothing to do
      backgroundGitOpsService.completeOperation(operationId, {
        noChanges: true,
        reason: result.error,
      });

      logger.info('[AUTO-COMMIT] No commit made on agent idle', {
        workspaceId,
        agentId,
        reason: result.error,
      });
    } else {
      // Real failure (staging error, commit error, file tracking unavailable, etc.)
      backgroundGitOpsService.failOperation(operationId, result.error);

      logger.warn('[AUTO-COMMIT] Auto-commit failed', {
        workspaceId,
        agentId,
        reason: result.error,
      });
    }
  } catch (error) {
    // commitAgentChanges threw unexpectedly - fail the operation so it doesn't stay stuck in 'started'
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[AUTO-COMMIT] Unexpected error during auto-commit', {
      workspaceId,
      agentId,
      error: errorMessage,
    });
    backgroundGitOpsService.failOperation(operationId, `Auto-commit failed: ${errorMessage}`);
  }
}



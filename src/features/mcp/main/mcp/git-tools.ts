/**
 * Git MCP Tools
 *
 * Provides git operations as MCP tools for agents to use.
 */

import {
  BaseMCPTool,
  createInputSchema,
  stringProperty,
  booleanProperty,
  arrayProperty,
} from './tool';
import { ToolCall, ToolResult } from './protocol';
import { Logger } from '../../../../shared/logger';
import { WorkspaceId } from '../../../../shared/types/branded-ids';

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

const logger = new Logger('GitTools');

/**
 * Tool to get git status
 */
export class GitStatusTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'git_status',
      'Get the current git status showing modified, staged, and untracked files',
      createInputSchema({}, []),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { gitService } = await import('../../../git/main/git.service');

      const result = await gitService.getStatus(WorkspaceId(this.workspaceId));

      if (!result.ok) {
        return this.error(`Failed to get git status: ${result.error}`);
      }

      const status = result.data;
      const lines: string[] = [];

      lines.push(`Branch: ${status.branch || '(detached)'}`);
      if (status.ahead > 0 || status.behind > 0) {
        lines.push(`Ahead: ${status.ahead}, Behind: ${status.behind}`);
      }

      if (status.files.length === 0) {
        lines.push('\nWorking tree clean - no changes');
      } else {
        lines.push(`\nChanges (${status.files.length} files):`);
        for (const file of status.files) {
          const staged = file.staged ? '[staged] ' : '';
          lines.push(`  ${staged}${file.status} ${file.path}`);
        }
      }

      return this.success(lines.join('\n'), { status });
    } catch (error) {
      logger.error('Git status failed', error as Error);
      return this.error(`Git status failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to stage files for commit
 *
 * IMPORTANT: Agents should only stage specific files they have modified.
 * Staging "." (all files) is not allowed to prevent accidentally committing
 * changes made by setup scripts or other non-agent sources.
 */
export class GitStageTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'git_stage',
      'Stage specific files for commit. You must specify individual file paths - staging all files is not allowed.',
      createInputSchema(
        {
          paths: {
            ...stringProperty('File paths to stage, comma-separated. Must be specific file paths.'),
          },
        },
        ['paths'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { paths } = call.arguments;
      const { gitService } = await import('../../../git/main/git.service');

      // Prevent staging all files - agents should only stage specific files they've modified
      // This prevents accidentally committing setup script changes or other non-agent changes
      if (paths === '.' || paths === '*' || paths.includes('--all')) {
        logger.warn('Agent attempted to stage all files, which is not allowed', {
          workspaceId: this.workspaceId,
          paths,
        });
        return this.error(
          'Staging all files is not allowed. Please specify individual file paths to stage. ' +
            'Use git_status to see which files you have modified, then stage only those specific files.',
        );
      }

      const pathList = paths
        .split(',')
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);

      if (pathList.length === 0) {
        return this.error(
          'No file paths provided. Please specify at least one file path to stage.',
        );
      }

      const result = await gitService.stageFiles(WorkspaceId(this.workspaceId), pathList);

      if (!result.ok) {
        return this.error(`Failed to stage files: ${result.error}`);
      }

      return this.success(
        `Staged ${pathList.length} file(s): ${pathList.slice(0, 5).join(', ')}${pathList.length > 5 ? '...' : ''}`,
      );
    } catch (error) {
      logger.error('Git stage failed', error as Error);
      return this.error(`Git stage failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to commit staged changes
 *
 * @deprecated Use AgentCommitChangesTool (agent_commit_changes) instead.
 * This tool is kept for backward compatibility but agents should use
 * agent_commit_changes which automatically stages only the agent's changes.
 */
export class GitCommitTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'git_commit',
      'DEPRECATED: Use agent_commit_changes instead, which automatically stages your changes. ' +
        'This tool commits staged changes with a message. Stage files first using git_stage.',
      createInputSchema(
        {
          message: stringProperty('Commit message describing the changes'),
        },
        ['message'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { message } = call.arguments;
      const agentId = call.context?.agentId;

      // Check auto-commit setting - this deprecated tool should respect the workspace setting
      const { assertAgentCommitAllowed } = await import(
        '../../../workspace/main/workspace-settings.service'
      );
      const commitCheck = assertAgentCommitAllowed(this.workspaceId);
      if (!commitCheck.allowed) {
        logger.info('git_commit rejected: auto-commit disabled for workspace', {
          workspaceId: this.workspaceId,
          agentId,
        });
        return this.error(commitCheck.reason);
      }

      const { gitService } = await import('../../../git/main/git.service');

      // Build commit message with agent trailers if available
      let fullMessage = message;
      if (agentId) {
        // Add Agent-Id trailer (git convention: blank line then key: value pairs)
        fullMessage = `${message}\n\nAgent-Id: ${agentId}`;
      }

      const result = await gitService.commit(WorkspaceId(this.workspaceId), fullMessage);

      if (!result.ok) {
        return this.error(`Failed to commit: ${result.error}`);
      }

      const data = result.data;
      return this.success(`Committed: ${data?.hash?.substring(0, 7) || 'unknown'}\n${message}`, {
        hash: data?.hash,
        files: data?.files,
      });
    } catch (error) {
      logger.error('Git commit failed', error as Error);
      return this.error(`Git commit failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool for agents to commit their changes.
 *
 * This is the recommended way for agents to commit changes. It:
 * - Automatically stages only files attributed to the calling agent
 * - Respects the workspace's auto-commit setting
 * - Uses the git operation mutex to prevent race conditions with other agents
 * - Adds proper git trailers for attribution tracking
 *
 * Primary use case: User explicitly asks agent to commit before task completion.
 * Auto-commits on task completion are handled separately by auto-commit.service.ts
 */
export class AgentCommitChangesTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'agent_commit_changes',
      `Commit your changes with a descriptive message. Automatically stages only files you modified.

Use this when the user explicitly asks you to commit. Your changes are committed automatically when you complete your task, so you don't need to call this normally.

If auto-commit is disabled for this workspace, you must set userRequested: true to confirm the user asked for this commit.`,
      createInputSchema(
        {
          message: stringProperty('Commit message describing your changes'),
          files: arrayProperty(
            'Optional: specific files to commit. Defaults to all your uncommitted changes.',
            'string',
          ),
          userRequested: booleanProperty(
            'Set to true if the user explicitly asked you to commit. Required when auto-commit is disabled.',
            { default: false },
          ),
        },
        ['message'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { message, files, userRequested = false } = call.arguments;
      const agentId = call.context?.agentId;

      if (!agentId) {
        return this.error('No agent context available. This tool must be called by an agent.');
      }

      // Check auto-commit setting using centralized guard
      const { assertAgentCommitAllowed } = await import(
        '../../../workspace/main/workspace-settings.service'
      );
      const commitCheck = assertAgentCommitAllowed(this.workspaceId, { userRequested });
      if (!commitCheck.allowed) {
        logger.info('agent_commit_changes rejected: auto-commit disabled and userRequested=false', {
          workspaceId: this.workspaceId,
          agentId,
        });
        return this.error(commitCheck.reason);
      }

      // Delegate to shared commit logic
      const { commitAgentChanges } = await import('../../../agent/main/agent-commit.service');

      const result = await commitAgentChanges({
        workspaceId: this.workspaceId,
        agentId,
        message,
        files: files as string[] | undefined,
      });

      if (!result.ok) {
        return this.error(result.error);
      }

      return this.success(
        `Committed ${result.data.fileCount} file(s): ${result.data.hash.slice(0, 7)}\n${message}`,
        { hash: result.data.hash, files: result.data.files },
      );
    } catch (error) {
      logger.error('agent_commit_changes failed', error as Error);
      return this.error(`Failed to commit: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to check for merge conflicts between current branch and a target branch.
 *
 * Uses git merge-tree to simulate a merge without modifying the working tree.
 * Works for both PR-based and non-PR workspaces using local git operations.
 */
export class CheckMergeConflictsTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'check_merge_conflicts',
      'Check if merging the current branch into a target branch would cause conflicts. ' +
        'Returns conflict status and affected files if detectable.',
      createInputSchema(
        {
          targetBranch: stringProperty(
            'Optional target branch to check merge against (defaults to main or master)',
          ),
        },
        [],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { targetBranch: requestedTarget } = call.arguments;
      const { gitService } = await import('../../../git/main/git.service');
      const { getWorkspaceGitInfo } = await import('../../../git/main/git-router');
      const gitEnv = await import('../../../../shared/git/git-env');
      const { execFileAsync } = gitEnv;

      // Get workspace git info for worktree path
      const gitInfo = await getWorkspaceGitInfo(this.workspaceId);
      if (!gitInfo) {
        return this.error('Could not find workspace git info');
      }
      const worktreePath = gitInfo.worktreePath;

      // Get current branch
      const branchResult = await gitService.getCurrentBranch(WorkspaceId(this.workspaceId));
      if (!branchResult.ok) {
        return this.error(`Failed to get current branch: ${branchResult.error}`);
      }
      const currentBranch = branchResult.data;

      // Determine target branch
      let targetBranch = requestedTarget;
      if (!targetBranch) {
        targetBranch = await this.detectDefaultBranch(worktreePath, execFileAsync);
      }

      if (!targetBranch) {
        return this.error(
          'Could not determine target branch. Please specify a targetBranch parameter.',
        );
      }

      if (currentBranch === targetBranch) {
        return this.success(
          `Current branch "${currentBranch}" is the same as target branch "${targetBranch}". No merge needed.`,
          { hasConflicts: false, targetBranch, currentBranch },
        );
      }

      // Detect merge conflicts
      const { hasConflicts, conflictedFiles, cannotDetermine } = await this.detectMergeConflicts(
        worktreePath,
        currentBranch,
        targetBranch,
        execFileAsync,
      );

      // Handle case where we cannot determine merge status (unrelated histories)
      if (cannotDetermine) {
        return this.success(
          `Current branch: ${currentBranch}\nTarget branch: ${targetBranch}\nBranches have no common ancestor (unrelated histories). Cannot determine merge conflicts.`,
          { hasConflicts: false, conflictedFiles: [], cannotDetermine: true, targetBranch, currentBranch },
        );
      }

      // Build response
      const lines: string[] = [];
      lines.push(`Current branch: ${currentBranch}`);
      lines.push(`Target branch: ${targetBranch}`);
      lines.push(`Has conflicts: ${hasConflicts}`);

      if (conflictedFiles.length > 0) {
        lines.push(`\nConflicted files (${conflictedFiles.length}):`);
        for (const file of conflictedFiles) {
          lines.push(`  - ${file}`);
        }
      } else if (hasConflicts) {
        lines.push('\nConflict details could not be determined at the file level.');
      } else {
        lines.push('\nNo conflicts detected. The branches can be merged cleanly.');
      }

      return this.success(lines.join('\n'), {
        hasConflicts,
        conflictedFiles,
        targetBranch,
        currentBranch,
      });
    } catch (error) {
      logger.error('Check merge conflicts failed', error as Error);
      return this.error(`Check merge conflicts failed: ${(error as Error).message}`);
    }
  }

  /**
   * Detect the default branch (main or master) by checking which exists locally.
   */
  private async detectDefaultBranch(
    worktreePath: string,
    execFile: ExecFileFn,
  ): Promise<string | null> {
    for (const branch of ['main', 'master']) {
      try {
        await execFile('git', ['rev-parse', '--verify', branch], { cwd: worktreePath });
        return branch;
      } catch {
        // Branch doesn't exist locally, try next
      }
    }
    return null;
  }

  /**
   * Detect merge conflicts between current branch and target branch.
   * Uses git merge-tree to simulate a merge without modifying the working tree.
   */
  private async detectMergeConflicts(
    worktreePath: string,
    currentBranch: string,
    targetBranch: string,
    execFile: ExecFileFn,
  ): Promise<{ hasConflicts: boolean; conflictedFiles: string[]; cannotDetermine?: boolean }> {
    try {
      // Get the merge base between the two branches
      // Note: git merge-base exits with code 1 when there's no common ancestor (unrelated histories)
      // We need to handle this case explicitly rather than letting it fall through to the outer catch
      let base: string;
      try {
        const { stdout: mergeBaseOutput } = await execFile(
          'git',
          ['merge-base', '--', targetBranch, currentBranch],
          { cwd: worktreePath },
        );
        base = mergeBaseOutput.trim();
      } catch {
        // git merge-base exits non-zero when there's no common ancestor
        // This indicates unrelated histories, not a conflict
        return { hasConflicts: false, conflictedFiles: [], cannotDetermine: true };
      }

      if (!base) {
        // No common ancestor - unrelated histories, can't determine merge result
        return { hasConflicts: false, conflictedFiles: [], cannotDetermine: true };
      }

      // Use git merge-tree to simulate a merge and check for conflicts
      const { stdout: mergeTreeOutput } = await execFile(
        'git',
        ['merge-tree', '--', base, targetBranch, currentBranch],
        { cwd: worktreePath },
      );

      // Check for conflict markers in the output
      const hasConflictMarkers =
        mergeTreeOutput.includes('<<<<<<<') ||
        mergeTreeOutput.includes('>>>>>>>') ||
        mergeTreeOutput.includes('=======');

      // Try to extract conflicted file names from merge-tree output
      // "changed in both" sections indicate files modified on both branches
      const conflictedFiles: string[] = [];
      if (hasConflictMarkers) {
        const lines = mergeTreeOutput.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === 'changed in both') {
            // Look for the "base" line which contains the file path
            // Format: "  base   100644 <sha> <filename>"
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
              const match = lines[j].match(/^\s+base\s+\d+\s+[a-f0-9]+\s+(.+)$/);
              if (match) {
                conflictedFiles.push(match[1]);
                break;
              }
            }
          }
        }
      }

      return { hasConflicts: hasConflictMarkers, conflictedFiles };
    } catch (error) {
      // If merge-tree fails (e.g., older git version), we can't reliably detect conflicts
      // Return a safe default indicating potential conflicts
      logger.warn(
        `merge-tree failed for ${currentBranch}..${targetBranch}, assuming potential conflicts`,
        error,
      );
      return { hasConflicts: true, conflictedFiles: [] };
    }
  }
}

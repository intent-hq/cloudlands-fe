import type { CommitInfo, GitStatus } from '$shared/types';

import { Logger } from '../../../../shared/logger';
import { WorkspaceId } from '../../../../shared/types/branded-ids';
import type { ToolCall } from './protocol';
import { backgroundGitOpsService } from '../../../git/main/background-git-ops.service';

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface WsGitAgentCommitOptions {
  files?: string[];
  userRequested?: boolean;
}

export interface BuildWsGitApiParams {
  workspaceId: string;
  call: ToolCall;
}

export interface WsGitApi {
  status(): Promise<GitStatus>;
  stage(paths: string | string[]): Promise<{ ok: true; paths: string[] }>;
  commit(message: string): Promise<{ ok: true; hash?: string; files?: string[] }>;
  agentCommit(
    message: string,
    opts?: WsGitAgentCommitOptions,
  ): Promise<{ ok: true; hash: string; files: string[]; fileCount: number }>;
  checkMergeConflicts(targetBranch?: string): Promise<{
    hasConflicts: boolean;
    conflictedFiles: string[];
    cannotDetermine?: boolean;
    targetBranch: string;
    currentBranch: string;
  }>;
}

const logger = new Logger('WsGitApi');

export function buildWsGitApi({ workspaceId, call }: BuildWsGitApiParams): WsGitApi {
  return {
    async status() {
      logger.info('ws.git.status()', { workspaceId });
      const { gitService } = await import('../../../git/main/git.service');
      const result = await gitService.getStatus(WorkspaceId(workspaceId));

      if (!result.ok) {
        throw new Error(`Failed to get git status: ${result.error}`);
      }

      return result.data;
    },

    async stage(paths) {
      logger.info('ws.git.stage()', { workspaceId, paths });
      const { gitService } = await import('../../../git/main/git.service');

      if (paths === '.' || paths === '*' || (typeof paths === 'string' && paths.includes('--all'))) {
        logger.warn('Agent attempted to stage all files, which is not allowed', {
          workspaceId,
          paths,
        });
        throw new Error(
          'Staging all files is not allowed. Please specify individual file paths to stage. ' +
            'Use git_status to see which files you have modified, then stage only those specific files.',
        );
      }

      const pathList = Array.isArray(paths)
        ? paths.map((path) => path.trim()).filter(Boolean)
        : paths
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean);

      if (pathList.length === 0) {
        throw new Error('No file paths provided. Please specify at least one file path to stage.');
      }

      const result = await gitService.stageFiles(WorkspaceId(workspaceId), pathList);
      if (!result.ok) {
        throw new Error(`Failed to stage files: ${result.error}`);
      }

      return { ok: true as const, paths: pathList };
    },

    async commit(message) {
      logger.info('ws.git.commit()', { workspaceId, hasAgentId: !!call.context?.agentId });

      const { assertAgentCommitAllowed } = await import(
        '../../../workspace/main/workspace-settings.service'
      );
      const commitCheck = assertAgentCommitAllowed(workspaceId);
      if (!commitCheck.allowed) {
        logger.info('ws.git.commit() rejected: auto-commit disabled for workspace', {
          workspaceId,
          agentId: call.context?.agentId,
        });
        throw new Error(commitCheck.reason);
      }

      const { gitService } = await import('../../../git/main/git.service');
      let fullMessage = message;

      if (call.context?.agentId) {
        fullMessage = `${message}\n\nAgent-Id: ${call.context.agentId}`;
      }

      const result = await gitService.commit(WorkspaceId(workspaceId), fullMessage);
      if (!result.ok) {
        throw new Error(`Failed to commit: ${result.error}`);
      }

      const data = result.data;
      return { ok: true as const, hash: data?.hash, files: data?.files };
    },

    async agentCommit(message, opts = {}) {
      logger.info('ws.git.agentCommit()', {
        workspaceId,
        agentId: call.context?.agentId,
        fileCount: opts.files?.length ?? 0,
        userRequested: opts.userRequested ?? false,
      });

      const agentId = call.context?.agentId;
      if (!agentId) {
        throw new Error('No agent context available. This tool must be called by an agent.');
      }

      const { assertAgentCommitAllowed } = await import(
        '../../../workspace/main/workspace-settings.service'
      );
      const commitCheck = assertAgentCommitAllowed(workspaceId, {
        userRequested: opts.userRequested ?? false,
      });
      if (!commitCheck.allowed) {
        logger.info('ws.git.agentCommit() rejected: auto-commit disabled and userRequested=false', {
          workspaceId,
          agentId,
        });
        throw new Error(commitCheck.reason);
      }

      let operationId: string | undefined;
      try {
        operationId = backgroundGitOpsService.registerOperation(WorkspaceId(workspaceId), 'commit', {
          agentId,
          agentName: call.context?.agentName,
          message,
        });

        const { commitAgentChanges } = await import('../../../agent/main/agent-commit.service');
        const result = await commitAgentChanges({
          workspaceId,
          agentId,
          message,
          files: opts.files,
        });

        if (!result.ok) {
          backgroundGitOpsService.failOperation(operationId, result.error);
          throw new Error(result.error);
        }

        backgroundGitOpsService.completeOperation(operationId, {
          commitHash: result.data.hash,
        });

        return {
          ok: true as const,
          hash: result.data.hash,
          files: result.data.files,
          fileCount: result.data.fileCount,
        };
      } catch (error) {
        if (operationId) {
          backgroundGitOpsService.failOperation(operationId, (error as Error).message);
        }
        throw error;
      }
    },

    async checkMergeConflicts(requestedTargetBranch) {
      logger.info('ws.git.checkMergeConflicts()', {
        workspaceId,
        targetBranch: requestedTargetBranch,
      });

      const { gitService } = await import('../../../git/main/git.service');
      const { getWorkspaceGitInfo } = await import('../../../git/main/git-router');
      const { execFileAsync } = await import('../../../../shared/git/git-env');

      const gitInfo = await getWorkspaceGitInfo(workspaceId);
      if (!gitInfo) {
        throw new Error('Could not find workspace git info');
      }

      const branchResult = await gitService.getCurrentBranch(WorkspaceId(workspaceId));
      if (!branchResult.ok) {
        throw new Error(`Failed to get current branch: ${branchResult.error}`);
      }

      const currentBranch = branchResult.data;
      const targetBranch =
        requestedTargetBranch ?? (await detectDefaultBranch(gitInfo.worktreePath, execFileAsync));

      if (!targetBranch) {
        throw new Error(
          'Could not determine target branch. Please specify a targetBranch parameter.',
        );
      }

      if (currentBranch === targetBranch) {
        return { hasConflicts: false, conflictedFiles: [], targetBranch, currentBranch };
      }

      const result = await detectMergeConflicts(
        gitInfo.worktreePath,
        currentBranch,
        targetBranch,
        execFileAsync,
      );

      return { ...result, targetBranch, currentBranch };
    },
  };
}

async function detectDefaultBranch(worktreePath: string, execFile: ExecFileFn): Promise<string | null> {
  for (const branch of ['main', 'master']) {
    try {
      await execFile('git', ['rev-parse', '--verify', branch], { cwd: worktreePath });
      return branch;
    } catch {
      // Branch doesn't exist locally, try next.
    }
  }

  return null;
}

async function detectMergeConflicts(
  worktreePath: string,
  currentBranch: string,
  targetBranch: string,
  execFile: ExecFileFn,
): Promise<{ hasConflicts: boolean; conflictedFiles: string[]; cannotDetermine?: boolean }> {
  try {
    await execFile('git', ['merge-tree', '--write-tree', '--name-only', '--', targetBranch, currentBranch], {
      cwd: worktreePath,
    });
    return { hasConflicts: false, conflictedFiles: [] };
  } catch (error) {
    const gitError = error as { code?: number; status?: number; stdout?: string; message?: string };
    const exitCode = gitError.code ?? gitError.status;
    const stdout = gitError.stdout ?? '';

    if (exitCode === 1) {
      const conflictedFiles: string[] = [];
      const lines = stdout.split('\n');
      let inConflictSection = false;

      for (const line of lines) {
        if (line.trim() === '') continue;
        if (inConflictSection) {
          const trimmed = line.trim();
          if (!trimmed.endsWith(':')) {
            conflictedFiles.push(trimmed);
          }
        }
        if (line.trim().endsWith(':')) {
          inConflictSection = true;
        }
      }

      return { hasConflicts: true, conflictedFiles };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('unknown option') || errorMessage.includes('unrecognized argument')) {
      return detectMergeConflictsLegacy(worktreePath, currentBranch, targetBranch, execFile);
    }

    logger.warn(`merge-tree failed for ${currentBranch}..${targetBranch}, assuming potential conflicts`, error);
    return { hasConflicts: true, conflictedFiles: [] };
  }
}

async function detectMergeConflictsLegacy(
  worktreePath: string,
  currentBranch: string,
  targetBranch: string,
  execFile: ExecFileFn,
): Promise<{ hasConflicts: boolean; conflictedFiles: string[]; cannotDetermine?: boolean }> {
  try {
    let base: string;
    try {
      const { stdout } = await execFile('git', ['merge-base', '--', targetBranch, currentBranch], {
        cwd: worktreePath,
      });
      base = stdout.trim();
    } catch {
      return { hasConflicts: false, conflictedFiles: [], cannotDetermine: true };
    }

    if (!base) {
      return { hasConflicts: false, conflictedFiles: [], cannotDetermine: true };
    }

    const { stdout } = await execFile('git', ['merge-tree', '--', base, targetBranch, currentBranch], {
      cwd: worktreePath,
    });

    const hasConflictMarkers = stdout.includes('<<<<<<<') && stdout.includes('>>>>>>>');
    const conflictedFiles: string[] = [];

    if (hasConflictMarkers) {
      const lines = stdout.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== 'changed in both') continue;

        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const match = lines[j].match(/^\s+base\s+\d+\s+[a-f0-9]+\s+(.+)$/);
          if (match) {
            conflictedFiles.push(match[1]);
            break;
          }
        }
      }
    }

    return { hasConflicts: hasConflictMarkers, conflictedFiles };
  } catch (error) {
    logger.warn(`legacy merge-tree failed for ${currentBranch}..${targetBranch}, assuming potential conflicts`, error);
    return { hasConflicts: true, conflictedFiles: [] };
  }
}
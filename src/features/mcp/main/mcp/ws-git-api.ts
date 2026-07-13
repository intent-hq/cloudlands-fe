import type { GitStatus } from '$shared/types';

import { Logger } from '../../../../shared/logger';
import type { ToolCall } from './protocol';
import { backgroundGitOpsService } from '../../../git/main/background-git-ops.service';
import { assertAgentCommitAllowed } from '$features/workspace/main/workspace-settings.service';
import { getBackendClient } from '$features/backend/main/backend.ipc';
import { WorkspaceId } from '../../../../shared/types/branded-ids';

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildWsGitApi({ workspaceId, call }: BuildWsGitApiParams): WsGitApi {
  return {
    async status() {
      logger.info('ws.git.status()', { workspaceId });
      try {
        return await getBackendClient().request<GitStatus>('git.status', { workspaceId });
      } catch (error) {
        throw new Error(`Failed to get git status: ${toErrorMessage(error)}`);
      }
    },

    async stage(paths) {
      logger.info('ws.git.stage()', { workspaceId, paths });
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

      try {
        await getBackendClient().request('git.stage', { workspaceId, paths: pathList });
      } catch (error) {
        throw new Error(`Failed to stage files: ${toErrorMessage(error)}`);
      }

      return { ok: true as const, paths: pathList };
    },

    async commit(message) {
      logger.info('ws.git.commit()', { workspaceId, hasAgentId: !!call.context?.agentId });

      const commitCheck = assertAgentCommitAllowed(workspaceId);
      if (!commitCheck.allowed) {
        logger.info('ws.git.commit() rejected: auto-commit disabled for workspace', {
          workspaceId,
          agentId: call.context?.agentId,
        });
        throw new Error(commitCheck.reason);
      }

      let fullMessage = message;

      if (call.context?.agentId) {
        fullMessage = `${message}\n\nAgent-Id: ${call.context.agentId}`;
      }

      try {
        const result = await getBackendClient().request<{
          hash?: string;
          files?: string[];
        }>('git.commit', { workspaceId, message: fullMessage });
        return { ok: true as const, hash: result?.hash, files: result?.files };
      } catch (error) {
        throw new Error(`Failed to commit: ${toErrorMessage(error)}`);
      }
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

        // Compose the Agent-Id trailer here: the daemon's `git.agentCommit`
        // wire arm has no agent context (router.rs:1325) so attribution
        // trailers are the MCP layer's responsibility.
        const fullMessage = buildAgentCommitMessage(message, agentId);

        const result = await getBackendClient().request<{
          hash?: string;
          files?: string[];
          fileCount?: number;
        }>('git.agentCommit', {
          workspaceId,
          message: fullMessage,
          files: opts.files,
          userRequested: opts.userRequested ?? false,
        });

        const hash = result?.hash ?? '';
        const files = Array.isArray(result?.files) ? result.files : [];
        const fileCount = typeof result?.fileCount === 'number' ? result.fileCount : files.length;

        backgroundGitOpsService.completeOperation(operationId, {
          commitHash: hash,
        });

        return {
          ok: true as const,
          hash,
          files,
          fileCount,
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

      try {
        const result = await getBackendClient().request<{
          hasConflicts: boolean;
          conflictedFiles: string[];
          cannotDetermine?: boolean;
          targetBranch: string;
          currentBranch: string;
        }>('git.checkMergeConflicts', {
          workspaceId,
          ...(requestedTargetBranch !== undefined ? { targetBranch: requestedTargetBranch } : {}),
        });
        return result;
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    },
  };
}

function buildAgentCommitMessage(message: string, agentId: string): string {
  const clean = message.trim().replace(/\n{3,}/g, '\n\n');
  return `${clean}\n\nAgent-Id: ${agentId}`;
}
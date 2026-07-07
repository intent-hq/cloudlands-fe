/**
 * Git Router
 *
 * Loads workspace git metadata and validates scope-restricted paths for local
 * workspaces. Remote-workspace routing retired in P3-5.
 */

import type { SSHConnectionConfig } from '../../../shared/main/ssh-manager';
import { WorkspaceConfig } from '../../../shared/main/config';
import { Logger } from '../../../shared/logger';
import fs from 'fs';
import path from 'path';

const logger = new Logger('GitRouter');

/**
 * Validate that file paths are within the workspace scope
 * @param filePaths - Array of file paths to validate (relative to worktreePath)
 * @param scope - Optional scope path (relative to worktreePath)
 * @param worktreePath - The base worktree path
 * @returns Error message if validation fails, null if all paths are valid
 */
export function validatePathsInScope(
  filePaths: string[],
  scope: string | undefined,
  worktreePath: string,
): string | null {
  // If no scope is set, all paths are allowed
  if (!scope) {
    return null;
  }

  // Normalize the scope path
  const normalizedScope = path.normalize(scope);
  const scopePath = path.join(worktreePath, normalizedScope);

  // Check each file path
  for (const filePath of filePaths) {
    // Normalize the file path
    const normalizedFilePath = path.normalize(filePath);

    // Resolve to absolute path if relative
    const absoluteFilePath = path.isAbsolute(normalizedFilePath)
      ? normalizedFilePath
      : path.join(worktreePath, normalizedFilePath);

    // Resolve to canonical path to handle .. and . references
    const resolvedFilePath = path.resolve(absoluteFilePath);
    const resolvedScopePath = path.resolve(scopePath);

    // Check if the file path is within the scope
    if (
      !resolvedFilePath.startsWith(resolvedScopePath + path.sep) &&
      resolvedFilePath !== resolvedScopePath
    ) {
      return `File "${filePath}" is outside the workspace scope "${scope}". Only files within the scope can be staged.`;
    }
  }

  return null;
}

export interface WorkspaceGitInfo {
  isRemote: boolean;
  worktreePath: string;
  repositoryPath?: string;
  sshConfig?: SSHConnectionConfig;
  /** The target branch name for this workspace (e.g., 'add-dark-mode') */
  branch?: string;
  scope?: string; // Optional relative path within worktreePath for scoped workspaces
}

/**
 * Get workspace git info from metadata
 */
export async function getWorkspaceGitInfo(workspaceId: string): Promise<WorkspaceGitInfo | null> {
  const workspaceJsonPath = WorkspaceConfig.paths.workspaceMetadata(workspaceId);

  if (!fs.existsSync(workspaceJsonPath)) {
    logger.warn('Workspace metadata not found', { workspaceId, workspaceJsonPath });
    return null;
  }

  try {
    const rawData = fs.readFileSync(workspaceJsonPath, 'utf-8');
    // Handle empty or whitespace-only files (can happen during concurrent writes)
    if (!rawData || rawData.trim().length === 0) {
      logger.warn('Workspace metadata file is empty', { workspaceId, workspaceJsonPath });
      return null;
    }
    const workspaceData = JSON.parse(rawData);
    const isRemote = workspaceData.isRemote === true;
    const worktreePath = workspaceData.worktreePath || workspaceData.repositoryPath;

    if (!worktreePath) {
      logger.warn('No worktree or repository path in workspace metadata', { workspaceId });
      return null;
    }

    let sshConfig: SSHConnectionConfig | undefined;
    if (isRemote && workspaceData.environmentConfig?.ssh) {
      const ssh = workspaceData.environmentConfig.ssh;
      sshConfig = {
        host: ssh.host,
        port: ssh.port || 22,
        username: ssh.user,
        password: ssh.password,
        privateKeyPath: ssh.key_path,
        useAgent: ssh.use_agent,
        transport: ssh.transport,
        wsUrl: ssh.ws_url,
      };
    }

    return {
      isRemote,
      worktreePath,
      repositoryPath: workspaceData.repositoryPath,
      sshConfig,
      branch: workspaceData.branch,
      scope: workspaceData.scope,
    };
  } catch (error) {
    logger.error('Failed to read workspace metadata', error as Error, { workspaceId });
    return null;
  }
}

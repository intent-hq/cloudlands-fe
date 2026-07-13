/**
 * Git Router
 *
 * Loads workspace git metadata and validates scope-restricted paths for local
 * workspaces. Remote-workspace routing retired in P3-5. Workspace metadata is
 * fetched from the intentd daemon via `workspace.get` (PROTOCOL.md §5.1) rather
 * than the retired on-disk `workspace.json` file.
 */

import type { SSHConnectionConfig } from '../../../shared/main/ssh-manager';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import { workspaceService } from '../../workspace/main/workspace.service';
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
 * Get workspace git info from metadata (served by the daemon via
 * `workspace.get`; the retired `workspace.json` disk read is no longer used).
 */
export async function getWorkspaceGitInfo(workspaceId: string): Promise<WorkspaceGitInfo | null> {
  const result = await workspaceService.getWorkspace(workspaceId as WorkspaceId);
  if (!result.ok) {
    logger.warn('Workspace metadata not found', { workspaceId, error: result.error });
    return null;
  }

  const workspace = result.data;
  const isRemote = workspace.isRemote === true;
  const worktreePath = workspace.worktreePath || workspace.repositoryPath;

  if (!worktreePath) {
    logger.warn('No worktree or repository path in workspace metadata', { workspaceId });
    return null;
  }

  // Remote-workspace routing was retired in P3-5 and the daemon no longer emits
  // an `environmentConfig` block; the SSH resolver stays here for parity but
  // becomes a no-op once `isRemote` is never set true (defensive).
  let sshConfig: SSHConnectionConfig | undefined;
  const ssh = workspace.environmentConfig?.ssh;
  if (isRemote && ssh) {
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
    repositoryPath: workspace.repositoryPath,
    sshConfig,
    branch: workspace.branch,
    scope: workspace.scope,
  };
}

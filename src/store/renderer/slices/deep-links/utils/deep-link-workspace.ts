/**
 * Pure helpers for the deep-links saga: matching a folder from the `intent`
 * CLI to an existing workspace, and mapping a `create` link onto the
 * New Space form's `workspace-prefill` payload.
 */

import { WorkspaceStatus, type Workspace } from '$shared/types';

/** sessionStorage key the New Space form (CompactWorkspaceInitializer) reads. */
export const WORKSPACE_PREFILL_KEY = 'workspace-prefill';

/** Forward slashes, no trailing separator (the root `/` stays `/`). */
export function normalizeFolderPath(path: string): string {
  const slashed = path.trim().replaceAll('\\', '/');
  const trimmed = slashed.replace(/\/+$/, '');
  return trimmed === '' && slashed.startsWith('/') ? '/' : trimmed;
}

/** The folder a workspace works in: its worktree, else its own checkout path. */
function workspaceFolder(workspace: Workspace): string | undefined {
  return workspace.worktreePath || workspace.path || workspace.repositoryPath;
}

function updatedAtMs(workspace: Workspace): number {
  const ms = Date.parse(workspace.updatedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The non-archived, non-deleted local workspace whose working folder is `folder`; when
 * several match, the most recently updated one. Archived workspaces never
 * match, so the caller creates a fresh workspace instead of reviving one.
 */
export function findWorkspaceForFolder(
  workspaces: readonly Workspace[],
  folder: string,
): Workspace | undefined {
  const target = normalizeFolderPath(folder);
  let best: Workspace | undefined;
  for (const workspace of workspaces) {
    if (workspace.archived || workspace.isRemote) continue;
    if (
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted
    )
      continue;
    const candidate = workspaceFolder(workspace);
    if (!candidate || normalizeFolderPath(candidate) !== target) continue;
    if (!best || updatedAtMs(workspace) > updatedAtMs(best)) best = workspace;
  }
  return best;
}

/** Title for a workspace created on `folder`: its last segment (`/` for the root). */
export function folderTitle(folder: string): string {
  const normalized = normalizeFolderPath(folder);
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

/**
 * The `workspace-prefill` payload for a `create` / `clone` link. Only form
 * fields are copied. `autoCreate` is deliberately dropped: an OS link — which
 * any web page or email can send — must never create a workspace or start an
 * agent without the user clicking Create.
 */
export function buildCreatePrefill(params: Record<string, string>): Record<string, string> {
  const prefill: Record<string, string> = {};
  if (params.repo) prefill.repoPath = params.repo;
  if (params.githubUrl) prefill.githubUrl = params.githubUrl;
  if (params.branch) prefill.branch = params.branch;
  if (params.prompt) prefill.prompt = params.prompt;
  if (params.specialist) prefill.specialist = params.specialist;
  if (params.title) prefill.title = params.title;
  return prefill;
}

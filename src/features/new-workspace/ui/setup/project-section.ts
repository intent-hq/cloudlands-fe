import type { DraftSource } from '$shared/types/workspace-draft';
import type { WorkspaceCreationRecentRepo } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-types';

export interface ProjectSectionVisibility {
  recent: boolean;
  githubRepos: boolean;
}

export function getProjectSectionVisibility(
  recentSourceCount: number,
  githubConnected: boolean,
): ProjectSectionVisibility {
  return {
    recent: recentSourceCount > 0,
    githubRepos: githubConnected,
  };
}

export function sourceFromRecentRepo(repo: WorkspaceCreationRecentRepo): DraftSource | null {
  if (repo.type === 'local') {
    return repo.path ? { kind: 'local', path: repo.path, isolation: 'worktree' } : null;
  }

  const match = repo.githubUrl?.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/);
  const owner = repo.owner ?? match?.[1];
  const name = repo.name || match?.[2];
  if (!repo.githubUrl || !owner || !name) return null;
  return { kind: 'github', url: repo.githubUrl, owner, name };
}

export function projectName(source: DraftSource): string {
  if (source.kind === 'github') return `${source.owner}/${source.name}`;
  if (source.kind === 'newFolder') return source.name;
  return source.path.split(/[\\/]/).filter(Boolean).pop() ?? source.path;
}

export function projectDescription(source: DraftSource): string {
  if (source.kind === 'local') return source.path;
  if (source.kind === 'newFolder') return `${source.parentPath}/${source.name}`;
  return source.branch ?? source.url;
}

export function projectIsolation(source: DraftSource): 'worktree' | 'in-place' | null {
  return source.kind === 'local' ? source.isolation : null;
}

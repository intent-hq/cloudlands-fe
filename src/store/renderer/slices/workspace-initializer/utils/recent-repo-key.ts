import type { WorkspaceInitializerRecentRepo } from '../workspace-initializer-types';

/** Match the source merge: local checkout paths are exact; GitHub shorthand ignores case. */
export function recentRepoKey(repo: Pick<WorkspaceInitializerRecentRepo, 'path' | 'type'>): string {
  return repo.type === 'github' ? `github:${repo.path.toLowerCase()}` : `local:${repo.path}`;
}

import type { WorkspaceInitializerRecentRepo } from '../workspace-initializer-types';

/** Local paths and full forge URLs are exact; only GitHub shorthand ignores case. */
export function recentRepoKey(repo: Pick<WorkspaceInitializerRecentRepo, 'path' | 'type'>): string {
  if (repo.type === 'local') return `local:${repo.path}`;
  const path = /^https:\/\//i.test(repo.path) ? repo.path : repo.path.toLowerCase();
  return `github:${path}`;
}

/**
 * Shared PR chip label used by both the monitored-PRs row and the PR-monitor
 * wake attribution surfaces, so the two cannot drift:
 *
 * - PR owner matches the workspace repository's owner (same or different
 *   repo) → `repo #N` (e.g. `monorepo #1234`, `cloudlands-fe #4567`)
 * - different owner, or workspace repository unknown → `owner/repo #N`
 *
 * `repo` is an `owner/name` string, split on the first `/`; owners compare
 * case-insensitively (GitHub logins are case-insensitive). The label is an
 * `org/repo #number` identifier, not user-facing prose.
 */

/** Repo segment of the label: `repo` same-owner, `owner/repo` cross-owner/unknown. */
export function getPrRepoLabel(repo: string, workspaceRepo?: string): string {
  const slash = repo.indexOf('/');
  const owner = slash === -1 ? undefined : repo.slice(0, slash);
  const name = slash === -1 ? repo : repo.slice(slash + 1);
  const workspaceSlash = workspaceRepo?.indexOf('/') ?? -1;
  const workspaceOwner =
    workspaceRepo && workspaceSlash !== -1 ? workspaceRepo.slice(0, workspaceSlash) : undefined;
  if (owner && workspaceOwner && owner.toLowerCase() === workspaceOwner.toLowerCase()) {
    return name;
  }
  return repo;
}

// i18n-ignore (org/repo #number identifier, not user-facing prose)
export function getPrChipLabel(repo: string, prNumber: number, workspaceRepo?: string): string {
  return `${getPrRepoLabel(repo, workspaceRepo)} #${prNumber}`;
}

import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import type { Workspace } from '$shared/types';
import type {
  HomeIntegrationScope,
  HomeIntegrationItem,
  IntegrationRepository,
} from './home-integrations-types';

/** Pure presentation of the explicit scope; no network or account reads. */
export function describeHomeIntegrationScope(scope: HomeIntegrationScope) {
  const organization = scope.kind === 'prs' ? scope.organization?.trim().toLowerCase() : undefined;
  return {
    key: JSON.stringify([
      scope.kind,
      scope.workspaceId,
      organization || null,
      [
        ...new Set(
          (organization ? [] : scope.repositories).map((repo) =>
            JSON.stringify([repo.key, repo.owner, repo.name]),
          ),
        ),
      ].sort(),
    ]),
    hasGitHubRepositories: !!organization || scope.repositories.some((repo) => !!repo.owner),
    hasLocalRepositories: !organization && scope.repositories.some((repo) => !repo.owner),
  };
}

/** Shared identity for legacy URLs, links to files/comments, and mixed-case repo names. */
export function homePullIdentity(url: string) {
  const ref = parseGitHubIssueOrPrUrl(url);
  if (ref?.kind !== 'pr' || !Number.isSafeInteger(ref.number) || ref.number <= 0) return null;
  const owner = ref.owner.toLowerCase();
  const repo = ref.repo.toLowerCase();
  return {
    owner,
    repo,
    number: ref.number,
    id: `${owner}/${repo}#${ref.number}`,
    url: `https://github.com/${owner}/${repo}/pull/${ref.number}`,
  };
}

export function collectHomeLinkedPulls(
  workspaces: Workspace[],
  repositories: IntegrationRepository[],
  organization?: string,
  scopedWorkspaceIds?: string[],
) {
  const scoped = workspaces.filter((workspace) =>
    scopedWorkspaceIds
      ? scopedWorkspaceIds.includes(workspace.id)
      : organization
        ? workspace.repositoryOwner?.toLowerCase() === organization.toLowerCase()
        : repositories.some(
            (repository) =>
              repository.owner?.toLowerCase() === workspace.repositoryOwner?.toLowerCase() &&
              repository.name.toLowerCase() === workspace.repositoryName?.toLowerCase(),
          ),
  );
  return [
    ...new Map(
      scoped
        .flatMap((workspace) => [
          ...(workspace.pullRequests ?? []).map((pull) => pull.url),
          workspace.activePullRequest?.url,
          workspace.prUrl,
        ])
        .flatMap((url) => {
          const pull = url ? homePullIdentity(url) : null;
          return pull
            ? [[pull.id, { owner: pull.owner, repo: pull.repo, number: pull.number }] as const]
            : [];
        }),
    ).values(),
  ].sort((a, b) =>
    `${a.owner}/${a.repo}#${a.number}`.localeCompare(`${b.owner}/${b.repo}#${b.number}`),
  );
}
export function showHomePullRepository(
  item: HomeIntegrationItem,
  repositories: IntegrationRepository[],
) {
  const [repository] = repositories;
  return (
    repositories.length !== 1 ||
    item.owner?.toLowerCase() !== repository?.owner?.toLowerCase() ||
    item.repo?.toLowerCase() !== repository?.name.toLowerCase()
  );
}

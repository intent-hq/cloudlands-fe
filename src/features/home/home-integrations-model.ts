import type { HomeIntegrationScope } from './home-integrations-types';

/** Pure presentation of the explicit scope; no network or account reads. */
export function describeHomeIntegrationScope(scope: HomeIntegrationScope) {
  const organization = scope.kind === 'prs' ? scope.organization?.trim().toLowerCase() : undefined;
  return {
    key: JSON.stringify([
      scope.kind,
      scope.workspaceId,
      organization || null,
      (organization ? [] : scope.repositories).map((repo) => [repo.key, repo.owner, repo.name]),
    ]),
    hasGitHubRepositories: !!organization || scope.repositories.some((repo) => !!repo.owner),
    hasLocalRepositories: !organization && scope.repositories.some((repo) => !repo.owner),
  };
}

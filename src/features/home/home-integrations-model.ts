import type { HomeIntegrationScope } from './home-integrations-types';

/** Pure presentation of the explicit scope; no network or account reads. */
export function describeHomeIntegrationScope(scope: HomeIntegrationScope) {
  return {
    key: JSON.stringify([
      scope.kind,
      scope.workspaceId,
      scope.repositories.map((repo) => [repo.key, repo.owner, repo.name]),
    ]),
    hasGitHubRepositories: scope.repositories.some((repo) => !!repo.owner),
    hasLocalRepositories: scope.repositories.some((repo) => !repo.owner),
  };
}

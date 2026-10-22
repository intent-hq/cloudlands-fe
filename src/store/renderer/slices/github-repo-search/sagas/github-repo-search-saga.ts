import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { call, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubRepo } from '$features/github-auth/types';
import {
  clearGithubRepoSearch,
  searchGithubRepos,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from '../github-repo-search-slice';
import type { GithubRepoItem } from '../../github-repos/github-repos-slice';

export const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const UNKNOWN_SEARCH_ERROR = 'Unknown error'; // i18n-ignore (wire-error normalization)

function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

function* searchGithubReposWorker(
  action: ReturnType<typeof searchGithubRepos>,
): SagaGenerator<void> {
  const connection = yield* selectPrincipalConnectionContext.effect();
  const query = action.payload[0].trim();
  if (query.length < MIN_QUERY_LENGTH) {
    yield* put(clearGithubRepoSearch());
    return;
  }

  yield* delay(SEARCH_DEBOUNCE_MS);
  if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
  yield* put(setGithubRepoSearchLoading(query));
  const result: Awaited<ReturnType<typeof githubAuthClient.searchRepos>> = yield* call(
    [githubAuthClient, githubAuthClient.searchRepos],
    query,
  );
  if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
  if (!result.success) {
    yield* put(setGithubRepoSearchError(query, result.error ?? UNKNOWN_SEARCH_ERROR));
    return;
  }
  yield* put(setGithubRepoSearchResults(query, (result.data ?? []).map(normalizeRepo)));
}

export function* githubRepoSearchSaga(): SagaGenerator<void> {
  yield* takeLatest(searchGithubRepos, searchGithubReposWorker);
}

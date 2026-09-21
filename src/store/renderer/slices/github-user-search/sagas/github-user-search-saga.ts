import { call, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubUserSearchHit } from '$features/github-auth/types';
import {
  GITHUB_USER_QUERY_MIN_LENGTH,
  normalizeGithubUserQuery,
} from '$features/workspace-sharing/utils/github-user-query';
import { m } from '$shared/paraglide/messages.js';
import {
  clearGithubUserSearch,
  searchGithubUsers,
  setGithubUserSearchError,
  setGithubUserSearchLoading,
  setGithubUserSearchResults,
  type GithubUserSearchItem,
} from '../github-user-search-slice';

export const USER_SEARCH_DEBOUNCE_MS = 300;

function normalizeUser(user: GithubUserSearchHit): GithubUserSearchItem {
  return {
    login: user.login,
    githubUserId: user.id,
    avatarUrl: user.avatarUrl,
    htmlUrl: user.htmlUrl,
  };
}

function* searchGithubUsersWorker(
  action: ReturnType<typeof searchGithubUsers>,
): SagaGenerator<void> {
  const query = normalizeGithubUserQuery(action.payload[0]);
  if (query.length < GITHUB_USER_QUERY_MIN_LENGTH) {
    yield* put(clearGithubUserSearch());
    return;
  }

  yield* delay(USER_SEARCH_DEBOUNCE_MS);
  yield* put(setGithubUserSearchLoading(query));
  const result: Awaited<ReturnType<typeof githubAuthClient.searchUsers>> = yield* call(
    [githubAuthClient, githubAuthClient.searchUsers],
    query,
  );
  if (!result.success) {
    // The wire error is not user copy; surface the localized message instead.
    yield* put(setGithubUserSearchError(query, m.workspace_share_userSearchFailed_error()));
    return;
  }
  yield* put(setGithubUserSearchResults(query, (result.data ?? []).map(normalizeUser)));
}

export function* githubUserSearchSaga(): SagaGenerator<void> {
  yield* takeLatest(searchGithubUsers, searchGithubUsersWorker);
}

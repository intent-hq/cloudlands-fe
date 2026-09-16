import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type { SentryIssueResult } from '$features/sentry-auth/types';
import { store } from '../../store';
import type { AppSelector, StoreState } from '../../types';
import type {
  GitHubIssueSuggestion,
  GitHubPullRequestSuggestion,
  IssueSuggestion,
  IssueSuggestionPageState,
  IssueSuggestionRequest,
  IssueSuggestionSource,
} from './issue-suggestions-types';
import { issueSuggestionRequestKey } from './issue-suggestions-slice';

export interface IssueSuggestionPageView<T> extends Omit<IssueSuggestionPageState, 'items'> {
  items: T[];
}

function selectPage<T extends IssueSuggestion>(
  state: StoreState,
  requestKey: string,
): IssueSuggestionPageView<T> {
  const page = state.issueSuggestions.byRequestKey[requestKey];
  return page
    ? { ...page, items: getItems(page.items) as T[] }
    : {
        items: [],
        nextToken: null,
        isFetching: false,
        isLoadingMore: false,
        error: null,
        version: 0,
      };
}

export const selectLinearAssignedSuggestions: AppSelector<
  IssueSuggestionPageView<LinearIssueResult>
> = store.createSelector((state) => selectPage<LinearIssueResult>(state, 'linear-assigned'));
export const selectLinearCreatedSuggestions: AppSelector<
  IssueSuggestionPageView<LinearIssueResult>
> = store.createSelector((state) => selectPage<LinearIssueResult>(state, 'linear-created'));
export const selectLinearSearchSuggestions: AppSelector<
  IssueSuggestionPageView<LinearIssueResult>
> = store.createSelector((state) => selectPage<LinearIssueResult>(state, 'linear-search'));
export const selectSentrySuggestions: AppSelector<IssueSuggestionPageView<SentryIssueResult>> =
  store.createSelector((state) => selectPage<SentryIssueResult>(state, 'sentry'));
const selectGitHubPage = <T extends IssueSuggestion>(
  state: StoreState,
  source: IssueSuggestionSource,
  request: IssueSuggestionRequest,
) => selectPage<T>(state, issueSuggestionRequestKey(source, request));

export const selectGitHubIssueSuggestions = store.createSelector(
  (state, owner: string, repo: string, query: string) =>
    selectGitHubPage<GitHubIssueSuggestion>(state, 'github-issues', { owner, repo, query }),
);
export const selectGitHubPullRequestSuggestions = store.createSelector(
  (state, owner: string, repo: string, filter: IssueSuggestionRequest['filter'], query: string) =>
    selectGitHubPage<GitHubPullRequestSuggestion>(state, 'github-prs', {
      owner,
      repo,
      filter,
      query,
    }),
);
export const selectGitHubPullRequestDetail = store.createSelector(
  (state, owner: string, repo: string, number: number) =>
    selectGitHubPage<GitHubPullRequestSuggestion>(state, 'github-pr-detail', {
      owner,
      repo,
      number,
    }),
);
export const selectLastUsedContextSource = store.createSelector(
  (state) => state.issueSuggestions.lastUsedContextSource,
);

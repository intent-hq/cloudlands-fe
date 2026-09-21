import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE seam: the github-auth IPC client is stubbed so no daemon/IPC call happens.
// The saga runs against the REAL configured store, so dispatching
// `searchGithubUsers` exercises the debounce, min length, latest-wins,
// stale-response guard and localized error path end to end.
vi.mock('$features/github-auth/renderer/github-auth.client', () => ({
  githubAuthClient: {
    searchUsers: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  },
}));

import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import { store as appStore } from '$store/renderer/store';
import {
  clearGithubUserSearch,
  searchGithubUsers,
} from '$store/renderer/slices/github-user-search/github-user-search-slice';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { githubUserSearchSaga, USER_SEARCH_DEBOUNCE_MS } from './github-user-search-saga';

type Fn = ReturnType<typeof vi.fn>;
const searchApi = githubAuthClient as unknown as { searchUsers: Fn };

/** PROTOCOL §5.27 `github.users.search` hit as mapped by the IPC seam. */
const wireUser = (login: string, id: number) => ({
  id,
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
  htmlUrl: `https://github.com/${login}`,
});

const item = (login: string, id: number) => ({
  login,
  githubUserId: id,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
  htmlUrl: `https://github.com/${login}`,
});

const ok = (...users: ReturnType<typeof wireUser>[]) => ({ success: true, data: users });
const state = () => appStore.state.githubUserSearch;
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('githubUserSearchSaga (fake seam, real store)', () => {
  let stopSaga: () => void;
  let disposeStore: () => void;

  beforeAll(() => {
    disposeStore = appStore.init();
    stopSaga = appStore.runSaga(githubUserSearchSaga);
  });
  afterAll(() => {
    stopSaga();
    disposeStore();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    appStore.dispatch(clearGithubUserSearch());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('debounces and coalesces rapid keystrokes into one call', async () => {
    appStore.dispatch(searchGithubUsers('oc'));
    appStore.dispatch(searchGithubUsers('oct'));
    appStore.dispatch(searchGithubUsers('octo'));

    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS - 1);
    expect(searchApi.searchUsers).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(searchApi.searchUsers).toHaveBeenCalledTimes(1);
    expect(searchApi.searchUsers).toHaveBeenCalledWith('octo');
  });

  it('strips a leading @, trims, and stores the mapped results under that query', async () => {
    searchApi.searchUsers.mockResolvedValueOnce(
      ok(wireUser('octocat', 1), wireUser('octokit', 2)) as never,
    );

    appStore.dispatch(searchGithubUsers('  @octo '));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    await flush();

    expect(searchApi.searchUsers).toHaveBeenCalledWith('octo');
    expect(state().lastQuery).toBe('octo');
    expect(state().loading).toBe(false);
    expect(state().error).toBeNull();
    expect(getItems(state().results)).toEqual([item('octocat', 1), item('octokit', 2)]);
  });

  it('clears the slice on a query shorter than two characters without hitting the wire', async () => {
    searchApi.searchUsers.mockResolvedValueOnce(ok(wireUser('octocat', 1)) as never);
    appStore.dispatch(searchGithubUsers('octo'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    await flush();
    expect(getItems(state().results)).toHaveLength(1);

    vi.clearAllMocks();
    appStore.dispatch(searchGithubUsers('@o'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    await flush();

    expect(searchApi.searchUsers).not.toHaveBeenCalled();
    expect(state().lastQuery).toBe('');
    expect(getItems(state().results)).toEqual([]);
  });

  // The seam folds a daemon/IPC failure into `{ success: false, error }`; the
  // raw wire string is not user copy, so the slice carries the localized error.
  it('surfaces an unsuccessful envelope as a localized error, not the wire string', async () => {
    searchApi.searchUsers.mockResolvedValueOnce({ success: false, error: 'rate limited' } as never);

    appStore.dispatch(searchGithubUsers('octo'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    await flush();

    expect(state().error).toBeTruthy();
    expect(state().error).not.toBe('rate limited');
    expect(state().loading).toBe(false);
    expect(state().lastQuery).toBe('octo');
    expect(getItems(state().results)).toEqual([]);
  });

  it('drops a stale response so it cannot clobber newer results', async () => {
    let resolveSlow: (envelope: unknown) => void = () => {};
    searchApi.searchUsers
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSlow = resolve as (e: unknown) => void)),
      )
      .mockResolvedValueOnce(ok(wireUser('hubot', 3)) as never);

    appStore.dispatch(searchGithubUsers('octo'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    appStore.dispatch(searchGithubUsers('hub'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    await flush();

    expect(state().lastQuery).toBe('hub');
    expect(getItems(state().results)).toEqual([item('hubot', 3)]);

    resolveSlow(ok(wireUser('octocat', 1)));
    await flush();

    expect(state().lastQuery).toBe('hub');
    expect(getItems(state().results)).toEqual([item('hubot', 3)]);
  });

  // Clearing must also invalidate an in-flight request, otherwise its response
  // repopulates the slice after the user emptied (or replaced) the input.
  it('drops an in-flight response that settles after the slice was cleared', async () => {
    let resolveSlow: (envelope: unknown) => void = () => {};
    searchApi.searchUsers.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve as (e: unknown) => void)),
    );

    appStore.dispatch(searchGithubUsers('octo'));
    await vi.advanceTimersByTimeAsync(USER_SEARCH_DEBOUNCE_MS);
    expect(state().loading).toBe(true);

    appStore.dispatch(searchGithubUsers(''));
    await flush();
    expect(state().lastQuery).toBe('');

    resolveSlow(ok(wireUser('octocat', 1)));
    await flush();

    expect(state().lastQuery).toBe('');
    expect(state().loading).toBe(false);
    expect(getItems(state().results)).toEqual([]);
  });
});

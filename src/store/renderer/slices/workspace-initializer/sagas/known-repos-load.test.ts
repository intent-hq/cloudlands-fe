import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

vi.mock('$lib/client', () => ({ appClient: {} }));

import { initialState as gitlabAuthInitialState } from '../../gitlab-auth/gitlab-auth-slice';
import {
  ensureKnownReposLoaded,
  initialState,
  workspaceInitializerReducer,
  workspaceInitializerRecentReposRefreshFinished,
  workspaceInitializerRecentReposRefreshRequested,
} from '../workspace-initializer-slice';
import { KNOWN_REPOS_REFRESH_ID, KNOWN_REPOS_RELOAD_AFTER_MS } from '../utils/known-repos';
import { knownReposLoadSaga } from './workspace-initializer-repository-saga';

type Action = Parameters<typeof workspaceInitializerReducer>[1];

function start(role: 'owner' | 'guest' = 'owner') {
  const channel = stdChannel();
  let slice = initialState;
  const requests: ReturnType<typeof workspaceInitializerRecentReposRefreshRequested>[] = [];
  const dispatch = (action: Action) => {
    slice = workspaceInitializerReducer(slice, action);
    if (action.type === workspaceInitializerRecentReposRefreshRequested.type)
      requests.push(action as (typeof requests)[number]);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () =>
        withLegacyPrincipal(
          { gitlabAuth: gitlabAuthInitialState, workspaceInitializer: slice },
          role,
        ),
    },
    knownReposLoadSaga,
  );
  const finish = (status: 'ready' | 'failed') =>
    dispatch(
      workspaceInitializerRecentReposRefreshFinished(
        KNOWN_REPOS_REFRESH_ID,
        requests.at(-1)!.payload[1],
        status,
        [],
        [],
        [],
      ),
    );
  return { dispatch, requests, finish, task };
}

describe('palette full repo load', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('starts one load per open and reuses it while it runs (keystrokes never reload)', () => {
    const { dispatch, requests, task } = start();
    for (let i = 0; i < 5; i++) dispatch(ensureKnownReposLoaded());
    expect(requests).toHaveLength(1);
    expect(requests[0].payload[0]).toBe(KNOWN_REPOS_REFRESH_ID);
    task.cancel();
  });

  it('throttles reopen for 60 s after a ready load, then reloads', () => {
    const { dispatch, requests, finish, task } = start();
    dispatch(ensureKnownReposLoaded());
    finish('ready');
    dispatch(ensureKnownReposLoaded());
    expect(requests).toHaveLength(1);
    vi.advanceTimersByTime(KNOWN_REPOS_RELOAD_AFTER_MS);
    dispatch(ensureKnownReposLoaded());
    expect(requests).toHaveLength(2);
    task.cancel();
  });

  it('retries on the next open after a failed load', () => {
    const { dispatch, requests, finish, task } = start();
    dispatch(ensureKnownReposLoaded());
    finish('failed');
    dispatch(ensureKnownReposLoaded());
    expect(requests).toHaveLength(2);
    task.cancel();
  });

  it('does not load when workspace creation is hidden', () => {
    const { dispatch, requests, task } = start('guest');
    dispatch(ensureKnownReposLoaded());
    expect(requests).toHaveLength(0);
    task.cancel();
  });
});

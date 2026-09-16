import { describe, expect, it } from 'vitest';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';

import {
  hydrateLinearIssueFilter,
  linearAuthReducer,
  linearIssuesLoaded,
  linearIssuesLoadSettled,
  linearIssuesLoadStarted,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  setLinearIssueFilter,
} from './linear-auth-slice';

describe('linearAuthReducer', () => {
  it('starts with terminal auth, issue, and filter defaults', () => {
    expect(linearAuthReducer(undefined, { type: '@@INIT' })).toEqual({
      isAuthenticated: false,
      requiresDaemonAuth: false,
      isAuthenticating: false,
      oauthUrl: null,
      error: null,
      issues: createCollection('id'),
      isLoadingIssues: false,
      issueFilter: 'all',
      issueFilterLoaded: false,
    });
  });

  it('maps auth state and operation flags', () => {
    let state = linearAuthReducer(
      undefined,
      setLinearAuthState(true, true, 'https://linear.example/auth'),
    );
    expect(state).toMatchObject({
      isAuthenticated: true,
      requiresDaemonAuth: true,
      oauthUrl: 'https://linear.example/auth',
    });
    state = linearAuthReducer(state, setLinearIsAuthenticating(true));
    expect(state.isAuthenticating).toBe(true);
    state = linearAuthReducer(state, setLinearError('unavailable'));
    expect(state.error).toBe('unavailable');
  });

  it('distinguishes filter hydration from user selection', () => {
    const hydrated = linearAuthReducer(undefined, hydrateLinearIssueFilter('created'));
    expect(hydrated.issueFilter).toBe('created');
    expect(hydrated.issueFilterLoaded).toBe(true);
    const selected = linearAuthReducer(hydrated, setLinearIssueFilter('subscribed'));
    expect(selected.issueFilter).toBe('subscribed');
    expect(selected.issueFilterLoaded).toBe(true);
  });

  it('settles issue loading while retaining the loaded protocol projection', () => {
    const started = linearAuthReducer(undefined, linearIssuesLoadStarted());
    expect(started.isLoadingIssues).toBe(true);
    const issue = { id: 'issue-1', identifier: 'ENG-1', title: 'Fix connection' };
    const loaded = linearAuthReducer(started, linearIssuesLoaded([issue]));
    expect(getItems(loaded.issues)).toEqual([issue]);
    const settled = linearAuthReducer(loaded, linearIssuesLoadSettled());
    expect(settled.isLoadingIssues).toBe(false);
  });
});

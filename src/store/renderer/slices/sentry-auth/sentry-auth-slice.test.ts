import { describe, expect, it } from 'vitest';
import {
  cancelSentryAuth,
  clearSentryError,
  connectSentry,
  consumeSentryAuth,
  logoutSentry,
  sentryAuthReducer,
  setSentryAuthState,
  setSentryConnected,
  setSentryConnecting,
  setSentryError,
  setSentryLoadingProjects,
  setSentryLoggedOut,
  setSentryProjects,
  settleSentryAuth,
} from './sentry-auth-slice';
import {
  selectSentryAuthConsumerOperation,
  selectSentryIsDisconnecting,
} from './sentry-auth-selectors';
import type { StoreState } from '../../types';

describe('sentry auth reducer request ownership', () => {
  it('isolates consumer results and makes cancellation terminal for its request', () => {
    let state = sentryAuthReducer(
      sentryAuthReducer.initialState,
      connectSentry('acme', 'fixture-token', { requestId: 'first', consumerId: 'settings' }),
    );
    expect(JSON.stringify(state)).not.toContain('fixture-token');
    state = sentryAuthReducer(
      state,
      connectSentry('acme', 'fixture-token', { requestId: 'second', consumerId: 'picker' }),
    );
    expect(sentryAuthReducer(state, settleSentryAuth('first', 'succeeded'))).toBe(state);
    expect(sentryAuthReducer(state, cancelSentryAuth('first'))).toBe(state);
    expect(sentryAuthReducer(state, consumeSentryAuth('first'))).toBe(state);
    const root = { sentryAuth: state } as StoreState;
    expect(selectSentryAuthConsumerOperation.select(root, 'settings')).toBeNull();
    expect(selectSentryAuthConsumerOperation.select(root, 'picker')?.requestId).toBe('second');
    state = sentryAuthReducer(state, setSentryLoadingProjects(true));
    state = sentryAuthReducer(state, cancelSentryAuth('second'));
    expect(state).toMatchObject({
      isConnecting: false,
      isLoadingProjects: false,
      operation: { status: 'cancelled' },
    });
    expect(sentryAuthReducer(state, settleSentryAuth('second', 'succeeded'))).toBe(state);
    expect(sentryAuthReducer(state, consumeSentryAuth('second')).operation).toBeNull();
  });

  it('keeps disconnect busy until the correlated request settles', () => {
    const state = sentryAuthReducer(
      sentryAuthReducer.initialState,
      logoutSentry({ requestId: 'logout', consumerId: null }),
    );
    expect(selectSentryIsDisconnecting.select({ sentryAuth: state } as StoreState)).toBe(true);
    const done = sentryAuthReducer(state, settleSentryAuth('logout', 'succeeded'));
    expect(selectSentryIsDisconnecting.select({ sentryAuth: done } as StoreState)).toBe(false);
  });

  it('preserves public auth/project/error state setters and logout cleanup', () => {
    let state = sentryAuthReducer(
      sentryAuthReducer.initialState,
      setSentryAuthState(true, 'acme', null),
    );
    state = sentryAuthReducer(state, setSentryConnecting(true));
    state = sentryAuthReducer(state, setSentryConnected('second'));
    expect(state).toMatchObject({
      isAuthenticated: true,
      organization: 'second',
      isConnecting: true,
    });
    state = sentryAuthReducer(state, setSentryError('failed'));
    expect(state.error).toBe('failed');
    state = sentryAuthReducer(state, clearSentryError());
    expect(state.error).toBeNull();
    const projects = [{ id: 'one', slug: 'one', name: 'One' }];
    state = sentryAuthReducer(state, setSentryProjects(projects));
    expect(state.projects).toEqual(projects);
    state = sentryAuthReducer(state, setSentryLoggedOut());
    expect(state).toMatchObject({ isAuthenticated: false, organization: null, projects: [] });
  });
});

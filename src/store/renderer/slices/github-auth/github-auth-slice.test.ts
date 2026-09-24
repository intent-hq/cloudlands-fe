import { describe, expect, it } from 'vitest';
import {
  authCancelled,
  authCompleted,
  cancelGitHubAuth,
  clearGitHubAuthError,
  githubAuthReducer,
  initializeGitHubAuth,
  logoutCompleted,
  logoutGitHub,
  setAuthenticating,
  setDeviceFlowInfo,
  setGitHubAuthError,
  setGitHubAuthState,
  setGitHubDisconnecting,
  setOAuthInfo,
  startGitHubAuth,
} from './github-auth-slice';

describe('github auth reducer', () => {
  it('closes callback acceptance on cancel/logout and reopens on deliberate start/hydration', () => {
    let state = githubAuthReducer.initialState;
    expect(state.callbacksCancelled).toBe(false);
    state = githubAuthReducer(state, cancelGitHubAuth());
    expect(state.callbacksCancelled).toBe(true);
    state = githubAuthReducer(state, startGitHubAuth());
    expect(state.callbacksCancelled).toBe(false);
    state = githubAuthReducer(state, logoutGitHub());
    expect(state.callbacksCancelled).toBe(true);
    state = githubAuthReducer(state, initializeGitHubAuth());
    expect(state.callbacksCancelled).toBe(false);
  });

  it('keeps authenticated state until logout succeeds and exposes pending logout', () => {
    let state = githubAuthReducer(
      githubAuthReducer.initialState,
      setGitHubAuthState({
        isAuthenticated: true,
        requiresDaemonAuth: false,
        user: null,
        needsScopeUpdate: false,
        oauthUrl: null,
      }),
    );
    state = githubAuthReducer(state, setGitHubDisconnecting(true));
    expect(state).toMatchObject({ isAuthenticated: true, isDisconnecting: true });
    state = githubAuthReducer(state, logoutCompleted());
    state = githubAuthReducer(state, setGitHubDisconnecting(false));
    expect(state).toMatchObject({ isAuthenticated: false, isDisconnecting: false });
  });

  it('preserves device-flow completion, cancellation, and error cleanup', () => {
    let state = githubAuthReducer(githubAuthReducer.initialState, setAuthenticating(true));
    state = githubAuthReducer(state, setOAuthInfo('https://github.com/login/device', true));
    state = githubAuthReducer(
      state,
      setDeviceFlowInfo({
        userCode: 'CODE',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      }),
    );
    const pending = state;
    expect(pending).toMatchObject({ isAuthenticating: true, needsScopeUpdate: true });
    state = githubAuthReducer(pending, authCancelled());
    expect(state).toMatchObject({ deviceFlow: null, oauthUrl: null, isAuthenticating: false });
    state = githubAuthReducer(pending, authCompleted(null));
    expect(state).toMatchObject({
      isAuthenticated: true,
      deviceFlow: null,
      isAuthenticating: false,
    });
    state = githubAuthReducer(pending, setGitHubAuthError('expired'));
    expect(state).toMatchObject({ error: 'expired', deviceFlow: null, isAuthenticating: false });
    expect(githubAuthReducer(state, clearGitHubAuthError()).error).toBeNull();
  });
});

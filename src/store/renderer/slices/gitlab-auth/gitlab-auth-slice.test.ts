import { describe, expect, it } from 'vitest';

import type { StoreState } from '../../types';
import {
  selectGitLabAuthDeviceFlow,
  selectGitLabAuthDeviceGrantSupported,
  selectGitLabAuthError,
  selectGitLabAuthHost,
  selectGitLabAuthIsAuthenticating,
  selectGitLabAuthIsConfigured,
  selectGitLabAuthMethod,
  selectGitLabAuthUser,
} from './gitlab-auth-selectors';
import {
  clearGitLabAuthError,
  connectGitLabWithToken,
  gitlabAuthCancelled,
  gitlabAuthCompleted,
  gitlabAuthReducer,
  gitlabDeviceGrantUnsupported,
  gitlabLogoutCompleted,
  initialState,
  setGitLabAuthenticating,
  setGitLabAuthError,
  setGitLabAuthStatus,
  setGitLabDeviceFlowInfo,
  setGitLabHost,
  takeGitLabPatToken,
} from './gitlab-auth-slice';

const flow = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://gitlab.com/oauth/device',
  expiresIn: 600,
  interval: 5,
};
const user = {
  id: '42',
  login: 'octo',
  displayName: 'Octo',
  avatarUrl: 'https://gitlab.com/a.png',
};

describe('gitlabAuthReducer', () => {
  it('starts unconfigured on gitlab.com with the PAT path as default', () => {
    expect(gitlabAuthReducer(undefined, { type: '@@init' })).toEqual(initialState);
    expect(initialState.host).toBe('gitlab.com');
    expect(initialState.deviceGrantSupported).toBe(false);
  });

  it('setGitLabHost to another instance drops the previous identity and pending grant', () => {
    const configuredA = {
      ...initialState,
      host: 'gitlab.com',
      isConfigured: true,
      deviceGrantSupported: true,
      user,
      method: 'pat' as const,
      deviceFlow: flow,
      error: 'stale',
    };
    expect(gitlabAuthReducer(configuredA, setGitLabHost('gitlab.example.com'))).toEqual({
      ...configuredA,
      host: 'gitlab.example.com',
      isConfigured: false,
      user: null,
      method: null,
      deviceFlow: null,
    });
    expect(gitlabAuthReducer(initialState, setGitLabHost('gitlab.example.com'))).toEqual({
      ...initialState,
      host: 'gitlab.example.com',
    });
  });

  it('setGitLabHost for the same instance (any case) keeps the configured identity', () => {
    const configured = {
      ...initialState,
      host: 'gitlab.example.com',
      isConfigured: true,
      user,
      method: 'device' as const,
    };
    expect(gitlabAuthReducer(configured, setGitLabHost('GitLab.Example.com'))).toEqual({
      ...configured,
      host: 'GitLab.Example.com',
    });
  });

  it('starting B after A was configured never presents A as B once B cancels or fails', () => {
    const configuredA = {
      ...initialState,
      host: 'gitlab.com',
      isConfigured: true,
      user,
      method: 'pat' as const,
    };
    const pendingB = [setGitLabHost('gitlab.example.com'), setGitLabAuthenticating(true)].reduce(
      gitlabAuthReducer,
      configuredA,
    );
    const unconfiguredB = {
      host: 'gitlab.example.com',
      isConfigured: false,
      isAuthenticating: false,
      user: null,
      method: null,
      deviceFlow: null,
    };
    expect(gitlabAuthReducer(pendingB, gitlabAuthCancelled())).toMatchObject(unconfiguredB);
    expect(gitlabAuthReducer(pendingB, setGitLabAuthError('rejected'))).toMatchObject({
      ...unconfiguredB,
      error: 'rejected',
    });
    expect(gitlabAuthReducer(pendingB, gitlabDeviceGrantUnsupported('no grant'))).toMatchObject({
      ...unconfiguredB,
      deviceGrantSupported: false,
      error: 'no grant',
    });
  });

  it('setGitLabAuthStatus hydrates the daemon-owned fields and leaves flow state alone', () => {
    const seeded = { ...initialState, isAuthenticating: true, deviceFlow: flow, error: 'x' };
    const state = gitlabAuthReducer(
      seeded,
      setGitLabAuthStatus({
        host: 'gitlab.example.com',
        isConfigured: true,
        deviceGrantSupported: true,
        user,
        method: 'pat',
      }),
    );
    expect(state).toEqual({
      ...seeded,
      host: 'gitlab.example.com',
      isConfigured: true,
      deviceGrantSupported: true,
      user,
      method: 'pat',
    });
  });

  it('setGitLabAuthenticating(true) clears a previous error; false keeps it', () => {
    const errored = { ...initialState, error: 'boom' };
    expect(gitlabAuthReducer(errored, setGitLabAuthenticating(true))).toEqual({
      ...initialState,
      isAuthenticating: true,
      error: null,
    });
    expect(gitlabAuthReducer(errored, setGitLabAuthenticating(false))).toEqual(errored);
  });

  it('setGitLabDeviceFlowInfo stores and clears the device codes', () => {
    const withFlow = gitlabAuthReducer(initialState, setGitLabDeviceFlowInfo(flow));
    expect(withFlow.deviceFlow).toEqual(flow);
    expect(gitlabAuthReducer(withFlow, setGitLabDeviceFlowInfo(null)).deviceFlow).toBeNull();
  });

  it('gitlabDeviceGrantUnsupported drops to the PAT path with the error', () => {
    const seeded = { ...initialState, isAuthenticating: true, deviceGrantSupported: true };
    expect(gitlabAuthReducer(seeded, gitlabDeviceGrantUnsupported('use a PAT'))).toEqual({
      ...initialState,
      deviceGrantSupported: false,
      isAuthenticating: false,
      deviceFlow: null,
      error: 'use a PAT',
    });
  });

  it('gitlabAuthCompleted marks the connection configured and clears the flow', () => {
    const seeded = { ...initialState, isAuthenticating: true, deviceFlow: flow, error: 'old' };
    expect(gitlabAuthReducer(seeded, gitlabAuthCompleted({ user, method: 'device' }))).toEqual({
      ...initialState,
      isConfigured: true,
      user,
      method: 'device',
    });
  });

  it('setGitLabAuthError stops authenticating and clears the flow; clear keeps the rest', () => {
    const seeded = { ...initialState, isAuthenticating: true, deviceFlow: flow };
    const errored = gitlabAuthReducer(seeded, setGitLabAuthError('denied'));
    expect(errored).toEqual({ ...initialState, error: 'denied' });
    expect(gitlabAuthReducer(errored, clearGitLabAuthError())).toEqual(initialState);
  });

  it('gitlabAuthCancelled resets the in-flight flow but keeps the configured identity', () => {
    const seeded = {
      ...initialState,
      isConfigured: true,
      user,
      method: 'pat' as const,
      isAuthenticating: true,
      deviceFlow: flow,
    };
    expect(gitlabAuthReducer(seeded, gitlabAuthCancelled())).toEqual({
      ...seeded,
      isAuthenticating: false,
      deviceFlow: null,
    });
  });

  it('gitlabLogoutCompleted returns to signed-out while keeping host and grant support', () => {
    const seeded = {
      ...initialState,
      host: 'gitlab.example.com',
      deviceGrantSupported: true,
      isConfigured: true,
      user,
      method: 'device' as const,
      deviceFlow: flow,
      isAuthenticating: true,
    };
    expect(gitlabAuthReducer(seeded, gitlabLogoutCompleted())).toEqual({
      ...initialState,
      host: 'gitlab.example.com',
      deviceGrantSupported: true,
    });
  });
});

describe('connectGitLabWithToken PAT handoff', () => {
  it('keeps the token off the action and hands it over exactly once by ref', () => {
    const action = connectGitLabWithToken('gitlab.example.com', 'glpat-handoff');

    expect(action.payload).toEqual({ host: 'gitlab.example.com', tokenRef: expect.any(Number) });
    expect(JSON.stringify(action)).not.toContain('glpat-handoff');
    expect(takeGitLabPatToken(action.payload.tokenRef)).toBe('glpat-handoff');
    expect(takeGitLabPatToken(action.payload.tokenRef)).toBeNull();
  });

  it('a newer connect supersedes a token that was never taken', () => {
    const stale = connectGitLabWithToken('gitlab.example.com', 'glpat-stale');
    const fresh = connectGitLabWithToken('gitlab.example.com', 'glpat-fresh');

    expect(fresh.payload.tokenRef).not.toBe(stale.payload.tokenRef);
    expect(takeGitLabPatToken(stale.payload.tokenRef)).toBeNull();
    expect(takeGitLabPatToken(fresh.payload.tokenRef)).toBe('glpat-fresh');
  });
});

describe('gitlabAuth selectors', () => {
  it('read the slice fields the UI binds to', () => {
    const gitlabAuth = {
      host: 'gitlab.example.com',
      isConfigured: true,
      deviceGrantSupported: true,
      user,
      method: 'device' as const,
      isAuthenticating: true,
      deviceFlow: flow,
      error: 'boom',
    };
    const state = { gitlabAuth } as StoreState;

    expect(selectGitLabAuthHost.select(state)).toBe('gitlab.example.com');
    expect(selectGitLabAuthIsConfigured.select(state)).toBe(true);
    expect(selectGitLabAuthDeviceGrantSupported.select(state)).toBe(true);
    expect(selectGitLabAuthUser.select(state)).toEqual(user);
    expect(selectGitLabAuthMethod.select(state)).toBe('device');
    expect(selectGitLabAuthIsAuthenticating.select(state)).toBe(true);
    expect(selectGitLabAuthDeviceFlow.select(state)).toEqual(flow);
    expect(selectGitLabAuthError.select(state)).toBe('boom');
  });

  it('reflect the signed-out initial state', () => {
    const state = { gitlabAuth: initialState } as StoreState;

    expect(selectGitLabAuthIsConfigured.select(state)).toBe(false);
    expect(selectGitLabAuthUser.select(state)).toBeNull();
    expect(selectGitLabAuthMethod.select(state)).toBeNull();
    expect(selectGitLabAuthDeviceFlow.select(state)).toBeNull();
    expect(selectGitLabAuthError.select(state)).toBeNull();
  });
});

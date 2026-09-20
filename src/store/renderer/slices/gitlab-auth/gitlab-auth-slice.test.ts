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
} from './gitlab-auth-slice';

const flow = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://gitlab.com/oauth/device',
  expiresIn: 600,
  interval: 5,
};
const user = { id: 42, login: 'octo', displayName: 'Octo', avatarUrl: 'https://gitlab.com/a.png' };

describe('gitlabAuthReducer', () => {
  it('starts unconfigured on gitlab.com with the PAT path as default', () => {
    expect(gitlabAuthReducer(undefined, { type: '@@init' })).toEqual(initialState);
    expect(initialState.host).toBe('gitlab.com');
    expect(initialState.deviceGrantSupported).toBe(false);
  });

  it('setGitLabHost only changes the host', () => {
    const state = gitlabAuthReducer(initialState, setGitLabHost('gitlab.example.com'));
    expect(state).toEqual({ ...initialState, host: 'gitlab.example.com' });
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

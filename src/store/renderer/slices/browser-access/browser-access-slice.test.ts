import { describe, expect, it } from 'vitest';

import type { BrowserAccessState } from '$shared/types/browser-access';
import {
  browserAccessReducer,
  createBrowserAccessSignInCodeRequested,
  initialState,
  loadBrowserAccessRequested,
  resetBrowserAccessKeyRequested,
  setBrowserAccessEnabledRequested,
} from './browser-access-slice';

const STATE: BrowserAccessState = {
  available: true,
  enabled: true,
  port: 47120,
  running: true,
  error: null,
  accessKey: 'k',
};

describe('browserAccessReducer', () => {
  it('tracks pending requests and stores main state on success', () => {
    const requested = setBrowserAccessEnabledRequested(true);
    let state = browserAccessReducer(initialState, requested);
    expect(state.pending).toBe(1);
    state = browserAccessReducer(state, requested.success(STATE));
    expect(state).toMatchObject({ current: STATE, pending: 0, failed: false });
  });

  it('keeps the last state and flags a failure', () => {
    const loaded = browserAccessReducer(initialState, loadBrowserAccessRequested().success(STATE));
    const requested = setBrowserAccessEnabledRequested(false);
    let state = browserAccessReducer(loaded, requested);
    state = browserAccessReducer(state, requested.failure(new Error('nope')));
    expect(state).toMatchObject({ current: STATE, pending: 0, failed: true });
  });

  const CODE = { code: 'ABC-DEF', expiresAt: 1, link: null };

  it('stores a created sign-in code and flags a failure', () => {
    const loaded = browserAccessReducer(initialState, loadBrowserAccessRequested().success(STATE));
    const requested = createBrowserAccessSignInCodeRequested();
    const created = browserAccessReducer(
      browserAccessReducer(loaded, requested),
      requested.success(CODE),
    );
    expect(created.signInCode).toEqual(CODE);
    const failed = browserAccessReducer(created, requested.failure(new Error('nope')));
    expect(failed.signInCodeFailed).toBe(true);
  });

  it('drops the sign-in code when the key resets or access turns off, but not on reload', () => {
    const loaded = browserAccessReducer(initialState, loadBrowserAccessRequested().success(STATE));
    const withCode = browserAccessReducer(
      loaded,
      createBrowserAccessSignInCodeRequested().success(CODE),
    );
    expect(
      browserAccessReducer(withCode, loadBrowserAccessRequested().success(STATE)).signInCode,
    ).toEqual(CODE);
    expect(
      browserAccessReducer(
        withCode,
        resetBrowserAccessKeyRequested().success({ ...STATE, accessKey: 'k2' }),
      ).signInCode,
    ).toBeNull();
    expect(
      browserAccessReducer(
        withCode,
        setBrowserAccessEnabledRequested(false).success({ ...STATE, enabled: false }),
      ).signInCode,
    ).toBeNull();
  });
});

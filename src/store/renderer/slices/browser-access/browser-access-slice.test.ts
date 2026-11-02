import { describe, expect, it } from 'vitest';

import type { BrowserAccessState } from '$shared/types/browser-access';
import {
  browserAccessReducer,
  initialState,
  loadBrowserAccessRequested,
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
    expect(state).toEqual({ current: STATE, pending: 0, failed: false });
  });

  it('keeps the last state and flags a failure', () => {
    const loaded = browserAccessReducer(initialState, loadBrowserAccessRequested().success(STATE));
    const requested = setBrowserAccessEnabledRequested(false);
    let state = browserAccessReducer(loaded, requested);
    state = browserAccessReducer(state, requested.failure(new Error('nope')));
    expect(state).toEqual({ current: STATE, pending: 0, failed: true });
  });
});

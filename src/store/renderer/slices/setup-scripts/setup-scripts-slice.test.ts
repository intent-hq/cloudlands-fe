import { describe, expect, it } from 'vitest';
import {
  dismissSetupScriptBannerGlobally,
  initialState,
  loadSetupScriptPresenceRequested,
  setupScriptPresenceLoadFailed,
  setupScriptsReducer,
} from './setup-scripts-slice';

describe('setupScriptsReducer banner dismissal persistence', () => {
  it('records global banner dismissal', () => {
    const next = setupScriptsReducer(initialState, dismissSetupScriptBannerGlobally());

    expect(next.isBannerDismissedGlobally).toBe(true);
  });

  it('keeps a failed presence read unknown and allows a later retry', () => {
    const loading = setupScriptsReducer(initialState, loadSetupScriptPresenceRequested('ws-test'));
    const failed = setupScriptsReducer(loading, setupScriptPresenceLoadFailed('ws-test'));

    expect(failed.presenceByWorkspaceId['ws-test']).toEqual({
      version: 1,
      status: 'error',
      hasScript: null,
    });

    const retrying = setupScriptsReducer(failed, loadSetupScriptPresenceRequested('ws-test'));
    expect(retrying.presenceByWorkspaceId['ws-test']).toEqual({
      version: 2,
      status: 'loading',
      hasScript: null,
    });
  });
});

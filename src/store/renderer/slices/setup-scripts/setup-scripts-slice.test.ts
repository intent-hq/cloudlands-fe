import { describe, expect, it } from 'vitest';
import {
  dismissSetupScriptBannerGlobally,
  initialState,
  setupScriptsReducer,
} from './setup-scripts-slice';

describe('setupScriptsReducer banner dismissal persistence', () => {
  it('records global banner dismissal', () => {
    const next = setupScriptsReducer(initialState, dismissSetupScriptBannerGlobally());

    expect(next.isBannerDismissedGlobally).toBe(true);
  });
});

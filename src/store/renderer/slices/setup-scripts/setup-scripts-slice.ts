import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { SetupScriptsState } from './setup-scripts-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SetupScriptsState = {
  isBannerDismissedGlobally: false,
  bannerDismissedByWorkspaceId: {},
};

export const dismissSetupScriptBannerGlobally = createAction(
  'setupScripts/dismissSetupScriptBannerGlobally',
);

// ============================================================================
// Reducer
// ============================================================================

export const setupScriptsReducer = createReducer<SetupScriptsState>(initialState);
setupScriptsReducer.with(dismissSetupScriptBannerGlobally, (state) => ({
  ...state,
  isBannerDismissedGlobally: true,
}));

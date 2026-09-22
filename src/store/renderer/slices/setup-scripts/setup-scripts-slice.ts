import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { SetupScriptPresenceState, SetupScriptsState } from './setup-scripts-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SetupScriptsState = {
  isBannerDismissedGlobally: false,
  bannerDismissedByWorkspaceId: {},
  presenceByWorkspaceId: {},
};

export const dismissSetupScriptBannerGlobally = createAction(
  'setupScripts/dismissSetupScriptBannerGlobally',
);
export const loadSetupScriptPresenceRequested = createAction<[workspaceId: string]>(
  'setupScripts/loadSetupScriptPresenceRequested',
);
export const setupScriptPresenceLoaded = createAction<[workspaceId: string, hasScript: boolean]>(
  'setupScripts/setupScriptPresenceLoaded',
);
export const setupScriptPresenceLoadFailed = createAction<[workspaceId: string]>(
  'setupScripts/setupScriptPresenceLoadFailed',
);

function loadingPresence(previous?: SetupScriptPresenceState): SetupScriptPresenceState {
  return {
    version: (previous?.version ?? 0) + 1,
    status: 'loading',
    hasScript: null,
  };
}

// ============================================================================
// Reducer
// ============================================================================

export const setupScriptsReducer = createReducer<SetupScriptsState>(initialState);
setupScriptsReducer.with(dismissSetupScriptBannerGlobally, (state) => ({
  ...state,
  isBannerDismissedGlobally: true,
}));
setupScriptsReducer.with(loadSetupScriptPresenceRequested, (state, { payload: [workspaceId] }) => ({
  ...state,
  presenceByWorkspaceId: {
    ...state.presenceByWorkspaceId,
    [workspaceId]: loadingPresence(state.presenceByWorkspaceId[workspaceId]),
  },
}));
setupScriptsReducer.with(
  setupScriptPresenceLoaded,
  (state, { payload: [workspaceId, hasScript] }) => {
    const previous = state.presenceByWorkspaceId[workspaceId] ?? loadingPresence();
    return {
      ...state,
      presenceByWorkspaceId: {
        ...state.presenceByWorkspaceId,
        [workspaceId]: { ...previous, status: 'success', hasScript },
      },
    };
  },
);
setupScriptsReducer.with(setupScriptPresenceLoadFailed, (state, { payload: [workspaceId] }) => {
  const previous = state.presenceByWorkspaceId[workspaceId] ?? loadingPresence();
  return {
    ...state,
    presenceByWorkspaceId: {
      ...state.presenceByWorkspaceId,
      [workspaceId]: { ...previous, status: 'error', hasScript: null },
    },
  };
});

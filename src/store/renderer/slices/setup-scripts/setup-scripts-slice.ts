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

function normalizeWorkspaceIds(workspaceIds: string[]): string[] {
  return [...new Set(workspaceIds.filter((workspaceId) => workspaceId.length > 0))];
}

// ============================================================================
// Actions
// ============================================================================

export const hydrateSetupScriptBannerDismissals = createAction<
  [isDismissedGlobally: boolean, workspaceIds: string[]]
>('setupScripts/hydrateSetupScriptBannerDismissals');

export const dismissSetupScriptBannerGlobally = createAction(
  'setupScripts/dismissSetupScriptBannerGlobally',
);

export const dismissSetupScriptBannerForWorkspace = createAction<[workspaceId: string]>(
  'setupScripts/dismissSetupScriptBannerForWorkspace',
);

// ============================================================================
// Reducer
// ============================================================================

export const setupScriptsReducer = createReducer<SetupScriptsState>(initialState);
setupScriptsReducer.with(
    hydrateSetupScriptBannerDismissals,
    (state, { payload: [isDismissedGlobally, workspaceIds] }) => ({
      ...state,
      isBannerDismissedGlobally: isDismissedGlobally,
      bannerDismissedByWorkspaceId: normalizeWorkspaceIds(workspaceIds).reduce<
        Record<string, true>
      >((acc, workspaceId) => {
        acc[workspaceId] = true;
        return acc;
      }, {}),
    }),
  );
setupScriptsReducer.with(dismissSetupScriptBannerGlobally, (state) => ({
    ...state,
    isBannerDismissedGlobally: true,
  }));
setupScriptsReducer.with(dismissSetupScriptBannerForWorkspace, (state, { payload: [workspaceId] }) => {
    if (!workspaceId) return state;
    return {
      ...state,
      bannerDismissedByWorkspaceId: {
        ...state.bannerDismissedByWorkspaceId,
        [workspaceId]: true,
      },
    };
  });

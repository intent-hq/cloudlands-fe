import { store } from '../../store';

export const selectIsSetupScriptBannerDismissed = store.createSelector(
  (state, workspaceId: string) =>
    state.setupScripts.isBannerDismissedGlobally ||
    state.setupScripts.bannerDismissedByWorkspaceId[workspaceId] === true,
);

import { store } from '../../store';
import type { SetupScriptPresenceState } from './setup-scripts-types';

const EMPTY_PRESENCE: SetupScriptPresenceState = {
  version: 0,
  status: 'idle',
  hasScript: null,
};

export const selectIsSetupScriptBannerDismissed = store.createSelector(
  (state, workspaceId: string) =>
    state.setupScripts.isBannerDismissedGlobally ||
    state.setupScripts.bannerDismissedByWorkspaceId[workspaceId] === true,
);

export const selectSetupScriptPresence = store.createSelector(
  (state, workspaceId: string): SetupScriptPresenceState =>
    state.setupScripts.presenceByWorkspaceId[workspaceId] ?? EMPTY_PRESENCE,
);

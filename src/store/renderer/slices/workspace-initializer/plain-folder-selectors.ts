/**
 * Plain-folder (git-optional) workspace creation, Labs. These read raw state
 * only, so a create surface rendered without the full store (or with other
 * selector modules mocked) sees the feature as unavailable and behaves as today.
 */
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  hasGitWorkspace,
  resolveInitializeGitDefault,
  supportsPlainFolderCreate,
} from '$lib/components/workspace/initializer/plain-folder-create';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { store } from '../../store';

/**
 * Creating plain folders is offered only with the Labs flag on and a daemon
 * that proves it accepts `plainFolder`; an older daemon would ignore `plainFolder` and
 * fall back to its legacy non-git create. Existing plain-folder rows never
 * read this gate.
 */
export const selectPlainFolderCreationAvailable = store.createSelector(
  (state) =>
    state.userPreferences?.labsPlainFolderWorkspacesEnabled === true &&
    supportsPlainFolderCreate(state.daemonHealth?.stats?.protocolVersion),
);

/**
 * Store-derived toggle default (before the remembered choice):
 * `'off-unless-gitlab'` is off once the GitLab status is read or its bounded
 * wait elapses; `'pending'` cannot be decided yet.
 */
export type InitializeGitDefaultState = 'on' | 'off' | 'off-unless-gitlab' | 'pending';

export const selectInitializeGitDefaultState = store.createSelector(
  (state): InitializeGitDefaultState => {
    const rows = state.workspace?.workspaces
      ? (getItems(state.workspace.workspaces) as Workspace[]).filter(
          (workspace) => workspace.id !== CHIEF_WORKSPACE_ID,
        )
      : [];
    const decided = resolveInitializeGitDefault({
      rememberedChoice: null,
      workspacesLoaded: state.workspace?.hasLoaded === true,
      hasGitWorkspace: hasGitWorkspace(rows),
      githubConnected: state.githubAuth?.isAuthenticated === true,
      githubSettled: state.githubAuth?.statusSettled === true,
      gitlabConnected: state.gitlabAuth?.isConfigured === true,
      gitlabSettled: true,
    });
    if (decided === null) return 'pending';
    if (decided) return 'on';
    return state.gitlabAuth?.statusReady === true ? 'off' : 'off-unless-gitlab';
  },
);

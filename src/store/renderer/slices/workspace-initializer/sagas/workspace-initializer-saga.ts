import { appClient } from '$lib/client';
import {
  selectCanAdministerHost,
  selectHostAdministrationContext,
} from '../../principal/principal-selectors';
import { getLocalStorageItem, getLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import {
  selectWorkspaceInitializerPersistedState,
  selectWorkspaceInitializerLocalCreation,
  selectWorkspaceInitializerReceiptContext,
} from '../workspace-initializer-selectors';
import { workspaceInitializerGitSaga } from './workspace-initializer-git-saga';
import { createWorkspaceInitializerSaga } from './workspace-initializer-saga-factory';

function removeOnboardingPrompt(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('onboarding-prompt');
    }
  } catch {
    // Reset remains non-fatal when session storage is unavailable.
  }
}

// Keep the Svelte startup and worker exports bound to the canonical source runtime.
export const {
  workspaceInitializerSaga,
  hydrateWorkspaceInitializerWorker,
  persistWorkspaceInitializerWorker,
} = createWorkspaceInitializerSaga({
  settingsClient: appClient.settings,
  localCreation: {
    select: selectWorkspaceInitializerLocalCreation,
    selectReceiptContext: selectWorkspaceInitializerReceiptContext,
  },
  selectCanAdministerHost,
  selectHostAdministrationContext,
  selectWorkspaceInitializerPersistedState,
  workspaceInitializerGitSaga,
  getLocalStorageJSON,
  getLocalStorageItem,
  removeOnboardingPrompt,
});

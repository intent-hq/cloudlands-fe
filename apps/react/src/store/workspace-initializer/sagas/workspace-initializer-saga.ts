import type { RepoValidationResult } from '$lib/utils/workspace-validation-factory';
import { all, call } from 'typed-redux-saga';
import { store } from '@/store';
import { backendRequest } from '@/features/backend/backend-transport';
import { settingsClient } from '@/features/settings/settings-client';
import { workspaceClient } from '@/features/workspace/workspace-client';
import {
  selectCanAdministerHost,
  selectHostAdministrationContext,
} from '@/store/principal/principal-selectors';
import * as selectors from '../workspace-initializer-selectors';
import { createWorkspaceInitializerSaga } from '../../../../../../src/store/renderer/slices/workspace-initializer/sagas/workspace-initializer-saga-factory';
import { createWorkspaceInitializerGitSaga } from '../../../../../../src/store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga-factory';
import { createLocalWorkspaceCreateSaga } from '../../../../../../src/store/renderer/slices/workspace-initializer/sagas/local-workspace-create-saga-factory';
import { createWorkspaceWithAdmission } from '../../../../../../src/store/renderer/slices/workspace/utils/workspace-create-client';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from '../../../../../../src/store/renderer/utils/safe-local-storage-saga';
import { createWorkspaceValidation } from '$lib/utils/workspace-validation-factory';

const gitSaga = createWorkspaceInitializerGitSaga({
  selectWorkspaceInitializerGitCheckContext: selectors.selectWorkspaceInitializerGitCheckContext,
  invoke: async () => ({
    success: true,
    data: await backendRequest<{ available: boolean }>('host.checkGit'),
  }),
});
const draft = createWorkspaceInitializerSaga({
  settingsClient,
  selectCanAdministerHost,
  selectHostAdministrationContext,
  localCreation: { select: selectors.selectWorkspaceLocalCreation, selectReceiptContext: selectors.selectWorkspaceInitializerReceiptContext },
  selectWorkspaceInitializerPersistedState: selectors.selectWorkspaceInitializerPersistedState,
  workspaceInitializerGitSaga: gitSaga,
  getLocalStorageItem,
  getLocalStorageJSON,
  removeOnboardingPrompt: () => {
    try {
      sessionStorage.removeItem('onboarding-prompt');
    } catch {
      /* Non-fatal legacy migration cleanup. */
    }
  },
});
const validation = createWorkspaceValidation({
  canCheckLocalPaths: () => !!selectors.selectWorkspaceLocalCreationLease.select(store.state),
  getDirectoryStatus: async (params) => ({
    success: true,
    data: await backendRequest<NonNullable<RepoValidationResult['directoryStatus']>>(
      'host.directoryStatus',
      params,
    ),
  }),
  // Never fall through to an unscoped filesystem read if the canonical status probe fails.
  fileExists: async () => ({ exists: false }),
  isRepository: async () => ({ isRepository: false }),
});
const createSaga = createLocalWorkspaceCreateSaga({
  selectState: selectors.selectWorkspaceInitializerState,
  selectAuthority: selectors.selectWorkspaceLocalCreationAuthority,
  selectLease: selectors.selectWorkspaceLocalCreationLease,
  validateRepoPath: validation.validateRepoPath,
  create: (request) =>
    createWorkspaceWithAdmission({ store, workspaces: workspaceClient }, request),
  persist: draft.persistWorkspaceInitializerWorker,
  newId: () => crypto.randomUUID(),
});
export function* workspaceInitializerSaga() {
  yield* all([call(draft.workspaceInitializerSaga), call(createSaga)]);
}

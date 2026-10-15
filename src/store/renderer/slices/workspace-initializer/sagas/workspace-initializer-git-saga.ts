import { invoke } from '$lib/electron-bridge';
import { selectWorkspaceInitializerGitCheckContext } from '../workspace-initializer-selectors';
import { createWorkspaceInitializerGitSaga } from './workspace-initializer-git-saga-factory';

// Source startup keeps its existing bridge; other apps bind their own transport.
export const workspaceInitializerGitSaga = createWorkspaceInitializerGitSaga({
  invoke,
  selectWorkspaceInitializerGitCheckContext,
});

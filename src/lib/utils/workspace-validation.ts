/** Source compatibility binding for existing workspace form consumers. */
import { invoke } from '$shared/generated/ipc-client';
import { createWorkspaceValidation } from './workspace-validation-factory';

// Retain these exports until source callers migrate to framework-neutral utilities.
export {
  getGitErrorMessage,
  parseGitHubUrl,
  sanitizeBranchPrefix,
  validateBranchName,
  validateBranchPrefix,
  validateInitialPrompt,
  type RepoValidationResult,
  type ValidationResult,
} from './workspace-validation-factory';

export const { validateRepoPath } = createWorkspaceValidation({
  canCheckLocalPaths: () => typeof window !== 'undefined' && !!window.electronAPI,
  getDirectoryStatus: (params) => invoke('file:getDirectoryStatus', params),
  fileExists: (params) => invoke('file:exists', params),
  isRepository: (params) => invoke('git:isRepository', params),
});

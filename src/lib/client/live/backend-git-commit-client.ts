import type { GitClient } from '../app-client';
import type { BackendRequestOptions } from './backend-transport-types';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';

/** The request boundary must call onDispatch immediately before transport invocation. */
export function createBackendGitCommitClient(
  request: <T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions & { onDispatch?: () => void },
  ) => Promise<T>,
): Pick<GitClient, 'commit'> {
  const runMutation = createRunMutation(request);
  return {
    async commit(workspaceId, params) {
      if (!params.userRequested) {
        return { success: false, error: 'git.agentCommit requires userRequested: true.' };
      }
      if (params.currentIndex && (params.files !== undefined || params.amend)) {
        return {
          success: false,
          error: 'Current-index commits require omitted files and no amend.',
        };
      }
      const payload = {
        workspaceId,
        message: params.message,
        ...(params.files !== undefined ? { files: params.files } : {}),
        userRequested: params.userRequested,
      };
      // Preserve the established explicit-files and legacy caller behavior.
      if (!params.currentIndex) return runMutation('git.agentCommit', payload);

      let dispatched = false;
      try {
        const response = await request<unknown>('git.agentCommit', payload, {
          onDispatch: () => {
            dispatched = true;
          },
        });
        if (response && typeof response === 'object') {
          const { ok, hash, files } = response as { ok?: unknown; hash?: unknown; files?: unknown };
          if (
            ok === true &&
            typeof hash === 'string' &&
            /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash) &&
            Array.isArray(files) &&
            files.every((path): path is string => typeof path === 'string' && path.length > 0)
          ) {
            return { success: true, commitOutcome: { state: 'confirmed', hash, files } };
          }
        }
        // A resolved but malformed receipt cannot prove that HEAD stayed unchanged.
        return { success: false, commitOutcome: { state: 'unknown' } };
      } catch (error) {
        return {
          success: false,
          error: mutationErrorMessage(error),
          ...(dispatched ? { commitOutcome: { state: 'unknown' as const } } : {}),
        };
      }
    },
  };
}

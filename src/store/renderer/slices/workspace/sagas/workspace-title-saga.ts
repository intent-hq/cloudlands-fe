import { logger } from '$lib/utils/client-logger';
import { workspaceClient } from '../utils/workspace.client';
import { selectPendingWorkspaceTitleToken, selectWorkspaceById } from '../workspace-selectors';
import { createWorkspaceTitleSaga } from './workspace-title-saga-factory';

/** Source compatibility binding until the Svelte title surfaces retire. */
export const workspaceTitleSaga = createWorkspaceTitleSaga({
  selectWorkspace: (workspaceId) => selectWorkspaceById.effect(workspaceId),
  selectPendingToken: (workspaceId) => selectPendingWorkspaceTitleToken.effect(workspaceId),
  async update(request) {
    const result = await workspaceClient.update(request);
    return result.ok
      ? { success: true, workspace: result.data }
      : { success: false, error: result.error };
  },
  onError: (error) => logger.error('Failed to rename workspace', error),
  async showError(message) {
    try {
      const { notify } = await import('$lib/components/patterns/notify');
      notify.error(message);
    } catch (error) {
      logger.error('Failed to surface workspace rename error', error);
    }
  },
});

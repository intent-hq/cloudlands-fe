import { BackendError } from '$lib/client/live/backend-transport-types';
import { electronAPI } from '$lib/client/live/electron-ipc-transport';
import { createDeletedAgentCleanup } from '../../../../../../src/store/renderer/slices/workspace-agents/sagas/deleted-agent-cleanup-factory';

/** Real preload binding; importing it does not start cleanup or install a watcher. */
export const cleanupDeletedAgentTabs = createDeletedAgentCleanup({
  async invoke(channel, data) {
    const api = electronAPI();
    if (typeof api?.invoke !== 'function') {
      throw new BackendError({
        code: 'UNAVAILABLE',
        // i18n-ignore (internal transport diagnostic shared with the real backend bridge)
        message: 'Backend bridge unavailable',
      });
    }
    return api.invoke(channel, data);
  },
});

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { InstalledEditor } from '../../store/renderer/slices/external-editors/external-editors-slice';

export interface DetectInstalledResponse {
  success: boolean;
  data?: InstalledEditor[];
  error?: string;
}

type ExternalEditorsClientDependencies = {
  invoke(
    channel: typeof IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
    params: { forceRefresh: boolean },
  ): Promise<DetectInstalledResponse>;
};

/** Original public async layer, bound to the owning renderer's detection route. */
export function createExternalEditorsClient({ invoke }: ExternalEditorsClientDependencies) {
  return {
    /**
     * Detect installed external editors. Resolves to the installed editor list on
     * success and throws on failure so callers can surface a load error.
     */
    async detectInstalled(forceRefresh = false): Promise<InstalledEditor[]> {
      const result = await invoke(IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED, { forceRefresh });
      if (result?.success && Array.isArray(result.data)) {
        return result.data;
      }
      throw new Error(result?.error || 'Failed to detect editors');
    },
  };
}

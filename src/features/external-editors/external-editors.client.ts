/**
 * External Editors client — thin renderer wrapper around the
 * `external-editors:detect-installed` IPC channel, mirroring the other feature
 * IPC clients (e.g. accept-changes.client.ts). Keeps the raw `invoke` out of the
 * lifecycle read middleware so the detect read can be mocked in isolation.
 */
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';

interface DetectInstalledResponse {
  success: boolean;
  data?: InstalledEditor[];
  error?: string;
}

export const externalEditorsClient = {
  /**
   * Detect installed external editors. Resolves to the installed editor list on
   * success and throws on failure so callers can surface a load error.
   */
  async detectInstalled(forceRefresh = false): Promise<InstalledEditor[]> {
    const result = await invoke<DetectInstalledResponse>(
      IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
      { forceRefresh },
    );
    if (result?.success && Array.isArray(result.data)) {
      return result.data;
    }
    throw new Error(result?.error || 'Failed to detect editors');
  },
};

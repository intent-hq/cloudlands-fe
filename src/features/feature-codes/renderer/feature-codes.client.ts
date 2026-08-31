/**
 * Feature Codes Client
 *
 * Renderer-side client for feature code operations.
 * Communicates with the main process via IPC.
 */

import { invoke } from '$lib/electron-bridge';
import { FEATURE_CODES_CHANNELS } from '$shared/ipc/channels';

export type ActivateCodeResult = {
  status: 'activated' | 'already_active' | 'invalid';
};

export const featureCodesClient = {
  /**
   * Fetch the currently active feature IDs (null when the fetch failed, so
   * callers can keep existing state instead of clobbering it with []).
   */
  async getActiveFeatures(): Promise<string[] | null> {
    try {
      const result = await invoke<{ features?: string[] }>(FEATURE_CODES_CHANNELS.GET_ACTIVE);
      return Array.isArray(result?.features) ? result.features : [];
    } catch {
      return null;
    }
  },

  /**
   * Activate a feature code
   */
  async activateCode(code: string): Promise<ActivateCodeResult> {
    return await invoke<ActivateCodeResult>(FEATURE_CODES_CHANNELS.ACTIVATE, { code });
  },

  /**
   * Deactivate a feature by ID
   */
  async deactivateFeature(featureId: string): Promise<{ success: boolean }> {
    return await invoke<{ success: boolean }>(FEATURE_CODES_CHANNELS.DEACTIVATE, { featureId });
  },

  /**
   * Relaunch the app so feature changes take effect
   */
  async restartApp(): Promise<void> {
    await invoke(FEATURE_CODES_CHANNELS.RESTART_APP);
  },
};

import { invoke } from '$lib/electron-bridge';
import { FORGE_AUTH_CHANNELS } from '../constants';
import type {
  ForgeAuthResult,
  ForgeAuthStatus,
  ForgeConnectParams,
  ForgeConnectResult,
  ForgeProvider,
  ForgeUser,
} from '../types';

/**
 * Provider-generic forge-auth client over the daemon's `sourceControl.*`
 * methods. The GitHub slice keeps its own client; this one serves GitLab (and
 * any provider the daemon adds) so the GitHub flow stays untouched.
 */
export const forgeAuthClient = {
  /** `sourceControl.authStatus { provider, host? }`; null when the probe failed. */
  async getStatus(provider: ForgeProvider, host?: string): Promise<ForgeAuthStatus | null> {
    try {
      return await invoke<ForgeAuthStatus | null>(
        FORGE_AUTH_CHANNELS.GET_STATUS,
        host ? { provider, host } : { provider },
      );
    } catch {
      return null;
    }
  },

  /**
   * `sourceControl.connect` — starts (or resumes) a device grant, or stores a
   * PAT when `method: "pat"`. The token is passed straight through and never
   * held or logged renderer-side.
   */
  async connect(params: ForgeConnectParams): Promise<ForgeConnectResult> {
    return await invoke<ForgeConnectResult>(FORGE_AUTH_CHANNELS.CONNECT, params);
  },

  /** `sourceControl.cancelAuth { provider }` — cancels the pending device grant. */
  async cancelAuth(provider: ForgeProvider): Promise<ForgeAuthResult> {
    return await invoke<ForgeAuthResult>(FORGE_AUTH_CHANNELS.CANCEL_AUTH, { provider });
  },

  /** `sourceControl.revoke { provider }` — deletes the stored credential daemon-side. */
  async revoke(provider: ForgeProvider): Promise<ForgeAuthResult> {
    return await invoke<ForgeAuthResult>(FORGE_AUTH_CHANNELS.REVOKE, { provider });
  },

  /** `sourceControl.getUser { provider }` — derived identity; null when unavailable. */
  async getUser(provider: ForgeProvider): Promise<ForgeUser | null> {
    try {
      return await invoke<ForgeUser | null>(FORGE_AUTH_CHANNELS.GET_USER, { provider });
    } catch {
      return null;
    }
  },
};

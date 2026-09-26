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
 * `{ provider, host? }` params shared by every host-bound method. `host` is
 * omitted (not sent empty) so the daemon resolves its configured instance.
 */
function hostParams(
  provider: ForgeProvider,
  host?: string,
): { provider: ForgeProvider; host?: string } {
  return host ? { provider, host } : { provider };
}

/**
 * Provider-generic forge-auth client over the daemon's `sourceControl.*`
 * methods. The GitHub slice keeps its own client; this one serves GitLab (and
 * any provider the daemon adds) so the GitHub flow stays untouched. Every
 * method is bound to `(provider, host)` — the daemon defaults `host` to its
 * persisted instance, which only follows a *successful* connect, so callers
 * pass the host they are acting on.
 */
export const forgeAuthClient = {
  /** `sourceControl.authStatus { provider, host? }`; null when the probe failed. */
  async getStatus(provider: ForgeProvider, host?: string): Promise<ForgeAuthStatus | null> {
    try {
      return await invoke<ForgeAuthStatus | null>(
        FORGE_AUTH_CHANNELS.GET_STATUS,
        hostParams(provider, host),
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

  /** `sourceControl.cancelAuth { provider, host? }` — cancels the pending device grant for that host. */
  async cancelAuth(provider: ForgeProvider, host?: string): Promise<ForgeAuthResult> {
    return await invoke<ForgeAuthResult>(
      FORGE_AUTH_CHANNELS.CANCEL_AUTH,
      hostParams(provider, host),
    );
  },

  /** `sourceControl.revoke { provider, host? }` — deletes the stored credential daemon-side. */
  async revoke(provider: ForgeProvider, host?: string): Promise<ForgeAuthResult> {
    return await invoke<ForgeAuthResult>(FORGE_AUTH_CHANNELS.REVOKE, hostParams(provider, host));
  },

  /** `sourceControl.getUser { provider, host? }` — derived identity; null when unavailable. */
  async getUser(provider: ForgeProvider, host?: string): Promise<ForgeUser | null> {
    try {
      return await invoke<ForgeUser | null>(
        FORGE_AUTH_CHANNELS.GET_USER,
        hostParams(provider, host),
      );
    } catch {
      return null;
    }
  },
};

import type { ForgeAuthMethod, ForgeDeviceFlowInfo, ForgeUser } from '$features/forge-auth/types';

/** Terminal transitions carried by `sourceControl:auth-changed { status }`. */
export type GitLabAuthChangedStatus = 'authorized' | 'expired' | 'denied' | 'error' | 'revoked';

export type GitLabAuthState = {
  /** GitLab instance host the connection targets (defaults to gitlab.com) */
  host: string;
  /** Whether a GitLab credential is configured daemon-side */
  isConfigured: boolean;
  /** Whether a connect (device grant or PAT) is in progress */
  isAuthenticating: boolean;
  /** Device-grant codes while a flow is pending (null otherwise) */
  deviceFlow: ForgeDeviceFlowInfo | null;
  /** Whether the host supports the device grant; false ⇒ lead with the PAT path */
  deviceGrantSupported: boolean;
  /** Derived GitLab identity (if configured) */
  user: ForgeUser | null;
  /** Error message if any */
  error: string | null;
  /** How the stored credential was obtained; null when not configured */
  method: ForgeAuthMethod | null;
};

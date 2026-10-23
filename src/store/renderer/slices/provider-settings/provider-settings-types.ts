import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  ProfileActivation,
  ProviderDefaultConfig,
  ProviderProfile,
  ProviderProfileFailure,
} from '$shared/provider-profiles';

export type ProviderSettingsRequest = {
  id: string;
  sessionId: string;
  resource: string;
  status: 'pending' | 'success' | 'failure' | 'cancelled';
};

export type ProviderSettingsRequestContext = { id: string; sessionId: string };

export type ProviderPaths = {
  configured: Record<string, string>;
  resolved: Record<string, string | null>;
  secondary: Record<string, string | null>;
  npxPackages: Record<string, string>;
};

export type ProviderFastModeState = {
  supported: boolean;
  confirmed: Record<string, boolean>;
  pending: Record<string, { enabled: boolean; editId: number }>;
  nextEditId: number;
  revision: number;
};

/**
 * Honest per-profile account status (§5.54 UI mapping): a saved profile is
 * `configured`; `checking` while this client's probe is pending; `ready` only
 * for `authenticated: true`; `error` for `false`. Saving never implies ready.
 */
export type ProviderProfileStatus = 'configured' | 'checking' | 'ready' | 'error';

export type ProviderProfileMutation = {
  id: string;
  kind: 'create' | 'update' | 'delete' | 'reorder' | 'updateDefault';
  profileId?: string;
  /** Reorder and updateDefault: the base provider concerned. */
  baseProviderId?: string;
  status: 'pending' | 'success' | 'failure';
  failure?: ProviderProfileFailure;
  activation?: ProfileActivation;
};

export type ProviderProfilesState = {
  /** Masked daemon reads only; values typed by the user never enter state. */
  items: Collection<ProviderProfile, 'id'>;
  /** Process-local daemon watermark; -1 until the first read on this connection. */
  revision: number;
  loadStatus: 'idle' | 'success' | 'failure';
  status: Record<string, ProviderProfileStatus>;
  /** Last env activation per profile (running processes on earlier settings). */
  activation: Record<string, ProfileActivation>;
  /**
   * Default configuration overrides by base provider id (§5.54), masked.
   * Empty on daemons that do not report them.
   */
  defaults: Record<string, ProviderDefaultConfig>;
  mutations: Collection<ProviderProfileMutation, 'id'>;
};

export type ProviderSettingsState = {
  profiles: ProviderProfilesState;
  fastMode: ProviderFastModeState;
  enabledProviders: Record<string, boolean>;
  nonDisableableProviderIds: string[];
  /** Local intent awaiting confirmation from daemon hydration. */
  pendingEnablementOverrides: Record<string, boolean>;
  /** Monotonic resource revisions reject old failures, including repeated values. */
  writeRevisions: Record<string, number>;
  sessions: string[];
  requests: Collection<ProviderSettingsRequest, 'id'>;
  paths: ProviderPaths;
  pathsRevision: number;
  pathsStatus: 'idle' | 'pending' | 'success' | 'failure';
  piAdapter: { installed: boolean | null; status: 'idle' | 'pending' | 'success' | 'failure' };
};

import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

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

export type ProviderTokenState = {
  status: 'loading' | 'ready' | 'error';
  configured: boolean;
  busy: boolean;
  failed: boolean;
  requestId: string;
};

export type ProviderSettingsState = {
  accessTokens: Record<string, ProviderTokenState>;
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

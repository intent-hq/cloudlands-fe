import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

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

export type ProviderSettingsState = {
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

/**
 * Analytics Service
 *
 * Central export point for analytics functionality.
 * Follows Augment's Event Tracking Specification.
 *
 * Usage:
 * ```typescript
 * import {
  initAnalytics,
  track,
  identify,
  page,
} from '$lib/services/analytics';
 *
 * // Initialize (call once at app startup)
 * await initAnalytics();
 *
 * // Track events (snake_case properties, Title Case event names)
 * track('Created Workspace', { workspace_id: '123', is_remote: false, from_template: false });
 *
 * // Identify users (only with consent)
 * identify('user-123', { plan: 'pro' });
 *
 * // Track page views
 * page('workspace');
 * ```
 */

export {
  initAnalytics,
  getAnalytics,
  isAnalyticsReady,
  track,
  identify,
  identifyUser,
  page,
  reset,
  setAnalyticsContextProvider,
} from './client';

export type {
  AnalyticsConfig,
  AnalyticsContextProvider,
  AnalyticsEventName,
  AnalyticsEvents,
  AnalyticsUIContext,
  CommonEventProperties,
  EventProperties,
  GitOpTrigger,
  UserTraits,
} from './types';

export { trackGitOp, isGitOp } from './track-git-op';
export type { GitOp } from './track-git-op';

export { extractDomain, getFileExtension } from './utils';

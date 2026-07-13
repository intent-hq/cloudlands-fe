/**
 * GitHub OAuth Configuration
 *
 * GitHub authentication is now managed through Augment's backend API.
 * The user authenticates via Augment's OAuth flow, and all GitHub API
 * operations are proxied through Augment's backend.
 *
 * The session.json file in ~/.augment/ contains the Augment access token
 * which is used to authenticate API calls.
 */

export const GITHUB_CONFIG = {
  // Polling configuration for checking OAuth completion
  pollIntervalMs: 3000,
  pollTimeoutMs: 300000, // 5 minutes max wait for user to authorize

  // Cache TTL for GitHub auth status
  statusCacheTtlMs: 30000, // 30 seconds
} as const;

export type GitHubConfig = typeof GITHUB_CONFIG;

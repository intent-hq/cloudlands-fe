/**
 * GitHub OAuth Configuration
 *
 * GitHub authentication is managed through the daemon's GitHub integration.
 * The user authenticates via the daemon's OAuth flow, and all GitHub API
 * operations are proxied through the daemon.
 */

export const GITHUB_CONFIG = {
  // Polling configuration for checking OAuth completion
  pollIntervalMs: 3000,
  pollTimeoutMs: 300000, // 5 minutes max wait for user to authorize

  // Cache TTL for GitHub auth status
  statusCacheTtlMs: 30000, // 30 seconds
} as const;

export type GitHubConfig = typeof GITHUB_CONFIG;

/**
 * Opportunistic repo-cache warming for GitHub-pick selections.
 *
 * When the new-workspace form has a GitHub repo selected (restored form
 * state, prefill, or an explicit pick), the FE fire-and-forgets
 * `repo.warmCache { githubUrl }` so the daemon refreshes its repo cache in
 * the background and the subsequent `workspace.create` hydrates from an
 * already-fresh cache.
 *
 * Purely best-effort: ALL failures are swallowed (busy rejection while a
 * warm is in flight, -32601 method-not-found on older daemons, offline) —
 * at most a debug log. Never surfaces in the UI.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('WarmRepoCache');

export interface RepoCacheWarmer {
  /**
   * Request a background cache warm for the current repo selection.
   * No-op unless `repoType === 'github'` with a non-empty `githubUrl`;
   * each distinct `githubUrl` fires at most once per warmer instance.
   */
  warm(selection: { repoType: 'local' | 'github' | 'remote'; githubUrl: string }): void;
}

/**
 * Create a per-form-instance warmer. `request` is injectable for tests and
 * defaults to the live daemon transport.
 */
export function createRepoCacheWarmer(
  request: (method: string, params?: unknown) => Promise<unknown> = backendRequest,
): RepoCacheWarmer {
  const requested = new Set<string>();
  return {
    warm({ repoType, githubUrl }) {
      if (repoType !== 'github' || !githubUrl) return;
      if (requested.has(githubUrl)) return;
      requested.add(githubUrl);
      void request('repo.warmCache', { githubUrl }).catch((error) => {
        logger.debug('repo.warmCache failed (ignored)', { githubUrl, error });
      });
    },
  };
}

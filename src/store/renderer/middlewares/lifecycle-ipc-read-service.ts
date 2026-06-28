/**
 * Lifecycle IPC read service — companion to `lifecycle-read-service` for the
 * Cluster C triggers whose reads are NOT AppClient-seam backed (raw IPC). Those
 * triggers went stale when the saga runtime was removed; this reconnects their
 * read path WITHOUT re-adding a saga and WITHOUT changing any call site.
 *
 * Wired here:
 *   `loadGithubRepos` → `githubAuthClient.listRepos()` (raw IPC), mapped into the
 *     Collection-friendly `GithubRepoItem` shape and stored via `setGithubRepos`.
 *   `fetchEditors`    → `externalEditorsClient.detectInstalled()` (raw IPC),
 *     honoring the `lastFetched`/loading cache guard unless `forceRefresh`.
 *
 * READ-ONLY: this module never invokes a mutation. Refreshes are coalesced per
 * key via an in-flight map so rapid dispatches collapse into a single fetch.
 *
 * Dependency-light per src/store AGENTS.md: imports only the feature IPC clients,
 * the configured store, slice actions, a pure collection lookup, and the logger
 * (NOT selectors — importing them would evaluate `store.createSelector` while the
 * store module is still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import type { GithubRepo } from "$features/github-auth/types";
import { externalEditorsClient } from "$features/external-editors/external-editors.client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from "../slices/github-repos/github-repos-slice";
import {
  CACHE_TTL_MS,
  clearError,
  fetchEditors,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  setLoading,
} from "../slices/external-editors/external-editors-slice";

const logger = createLogger("LifecycleIpcReadService");

/** In-flight refreshes keyed by domain; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/** Run `fn` deduped by `key`, swallowing errors so a failed read leaves state intact. */
function coalesce(key: string, fn: () => Promise<void>): void {
  const pending = inFlight.get(key);
  if (pending) return;
  const run = (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Refresh failed for ${key}`, error);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
}

/** Normalize a github-auth `GithubRepo` into the Collection-friendly shape. */
function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
}

/** Load the authenticated user's GitHub repos (mirrors the old github-repos saga). */
function refreshGithubRepos(): void {
  coalesce("githubRepos", async () => {
    appStore.dispatch(setGithubReposLoading());
    try {
      const repos = await githubAuthClient.listRepos();
      appStore.dispatch(setGithubRepos(repos.map(normalizeRepo)));
    } catch (error) {
      appStore.dispatch(
        setGithubReposError(error instanceof Error ? error.message : String(error)),
      );
    }
  });
}

/** Detect installed editors honoring the cache guard (mirrors the old fetch-editors saga). */
function refreshEditors(forceRefresh: boolean): void {
  const state = appStore.state.externalEditors;
  if (state.loading) return;
  if (!forceRefresh) {
    const editors = getItems(state.editors);
    if (editors.length > 0 && Date.now() - state.lastFetched < CACHE_TTL_MS) {
      return;
    }
  }
  coalesce("editors", async () => {
    appStore.dispatch(clearError());
    appStore.dispatch(setLoading(true));
    try {
      const editors = await externalEditorsClient.detectInstalled(forceRefresh);
      appStore.dispatch(fetchEditorsSuccess(editors, Date.now()));
    } catch (error) {
      appStore.dispatch(
        fetchEditorsFailure(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      appStore.dispatch(setLoading(false));
    }
  });
}

/** First array-payload element coerced to a boolean force-refresh flag. */
function forceRefreshOf(action: { payload?: unknown }): boolean {
  return Array.isArray(action.payload) ? Boolean(action.payload[0]) : false;
}

/**
 * Middleware giving the raw-IPC-backed Cluster C triggers real read handlers
 * again: after each action passes through the reducer, it kicks off a (deduped)
 * refresh. Fire-and-forget — dispatch stays synchronous.
 */
export function createLifecycleIpcReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action) {
      switch (action.type) {
        case loadGithubRepos.type:
          refreshGithubRepos();
          break;
        case fetchEditors.type:
          refreshEditors(forceRefreshOf(action));
          break;
      }
    }
    return result;
  };
}

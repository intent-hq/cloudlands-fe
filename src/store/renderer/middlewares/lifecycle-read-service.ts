/**
 * Lifecycle read service — restores the on-demand refresh/refetch handlers that
 * the boot seeders perform once but that became no-ops when the saga runtime was
 * removed. Several Cluster C trigger actions are dispatched from list rows, hover
 * cards, panels, and refresh buttons; with no saga listening they left their data
 * stale until an app restart re-ran the seeder.
 *
 * Like `git-read-service`, this reconnects the read path WITHOUT re-adding a saga
 * and WITHOUT changing any call site: `createLifecycleReadMiddleware()` observes
 * every dispatched action and, for each restored trigger, re-runs the SAME
 * `appClient` read the corresponding boot seeder uses and dispatches the SAME
 * `set*`/`*Succeeded` action to converge the store.
 *
 * READ-ONLY: this module never invokes a mutation. Refreshes are coalesced per
 * key via an in-flight map so rapid dispatches collapse into a single fetch.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, slice actions, a pure collection lookup, and the logger (NOT
 * selectors — importing them would evaluate `store.createSelector` while the
 * store module is still mid-initialization through the middleware chain).
 *
 * Scope note — actions deliberately NOT wired here (documented, left alone):
 *   `workspaceMounted` is a lifecycle fan-out with no single seam read; its
 *   sub-refreshes are covered by the individual panel triggers below. The
 *   `initContextForWorkspace`, `fetchEditors`, `loadKnownRepos`, and
 *   `loadGithubRepos` triggers are not AppClient-seam backed (localStorage / raw
 *   IPC) and need IPC-client restoration instead. `refreshAcceptChangesStatus`
 *   has a direct IPC companion (`AcceptChangesClient.getStatus`) the panels
 *   already call. `refreshRequested` (changes) reads backend-gated endpoints
 *   (`git.trackedChanges`/`git.commits`) that return empty in the live client,
 *   so wiring it would clear rather than refresh tracked changes.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { Workspace } from "$shared/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  loadRecencyData,
  loadWorkspacesRequested,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from "../slices/workspace/workspace-slice";
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksSucceeded,
} from "../slices/workspace-tasks/workspace-tasks-slice";
import { eventsLoaded, loadEventsRequested } from "../slices/workspace-events/workspace-events-slice";
import { loadSkillsRequested, setSkills } from "../slices/skills/skills-slice";
import { refreshScripts, setScriptsData, setScriptsInitialized } from "../slices/scripts/scripts-slice";
import {
  prStatusRefreshCompleted,
  prStatusRefreshStarted,
  refreshPRStatusRequested,
} from "../slices/pr-status/pr-status-slice";
import { prBranchLookupSucceeded } from "../slices/pr-branch-lookup/pr-branch-lookup-slice";
import type { PrBranchLookupPayload } from "../slices/pr-branch-lookup/pr-branch-lookup-types";

const logger = createLogger("LifecycleReadService");

/** In-flight refreshes keyed by `domain:wsId`; coalesces concurrent requests. */
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

/** Re-fetch the workspace list + recency (mirrors workspaces-seeder, data only). */
function refreshWorkspaces(): void {
  coalesce("workspaces", async () => {
    const workspaces = await appClient.workspaces.list();
    appStore.dispatch(replaceWorkspaceList(workspaces));
    appStore.dispatch(setWorkspaceHasLoaded(true));
    const recentViews = await appClient.workspaces.recentViews();
    appStore.dispatch(loadRecencyData({ lastViewedAt: recentViews }));
  });
}

/** Load tasks only when neither initialized nor loading (mirrors the old saga guard). */
function ensureTasks(wsId: string): void {
  const ws = appStore.state.workspaceTasks.byWorkspaceId[wsId];
  if (ws?.loading || ws?.initialized) return;
  coalesce(`tasks:${wsId}`, async () => {
    const tasks = await appClient.tasks.list(wsId);
    appStore.dispatch(loadWorkspaceTasksSucceeded(wsId, tasks));
  });
}

/** Re-fetch the workspace event stream (mirrors misc-ui-events-seeder). */
function refreshEvents(wsId: string): void {
  coalesce(`events:${wsId}`, async () => {
    const events = await appClient.events.list(wsId);
    appStore.dispatch(eventsLoaded(wsId, events));
  });
}

/** Re-fetch the workspace skills (mirrors misc-ui-events-seeder). */
function refreshSkills(wsId: string): void {
  coalesce(`skills:${wsId}`, async () => {
    const skills = await appClient.skills.list(wsId);
    appStore.dispatch(setSkills(wsId, skills));
  });
}

/** Re-fetch the workspace scripts (mirrors terminals-scripts-seeder). */
function refreshWorkspaceScripts(wsId: string): void {
  coalesce(`scripts:${wsId}`, async () => {
    const scripts = await appClient.scripts.list(wsId);
    appStore.dispatch(setScriptsData(wsId, scripts));
    appStore.dispatch(setScriptsInitialized(wsId, true));
  });
}

/** Re-fetch PR status + branch lookup (mirrors files-git-seeder PR section). */
function refreshPrStatus(wsId: string): void {
  coalesce(`prStatus:${wsId}`, async () => {
    appStore.dispatch(prStatusRefreshStarted(wsId));
    try {
      const prStatus = await appClient.git.prStatus(wsId);
      appStore.dispatch(prStatusRefreshCompleted(wsId, true));
      const workspace = getItem(appStore.state.workspace.workspaces, wsId as Workspace["id"]);
      const owner = workspace?.repositoryOwner;
      const repo = workspace?.repositoryName;
      if (prStatus?.prNumber != null && owner && repo) {
        const payload: PrBranchLookupPayload = {
          owner,
          repo,
          prNumber: prStatus.prNumber,
          key: `${owner}/${repo}#${prStatus.prNumber}`,
        };
        appStore.dispatch(prBranchLookupSucceeded(payload, workspace.branch));
      }
    } catch (error) {
      appStore.dispatch(prStatusRefreshCompleted(wsId, false, error instanceof Error ? error.message : String(error)));
    }
  });
}

/** First array-payload element as a non-empty workspace id, else undefined. */
function wsIdOf(action: { payload?: unknown }): string | undefined {
  const id = Array.isArray(action.payload) ? action.payload[0] : undefined;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Middleware giving the restored Cluster C triggers real read handlers again:
 * after each action passes through the reducer, it kicks off a (deduped) refresh
 * for the target domain/workspace. Fire-and-forget — dispatch stays synchronous.
 */
export function createLifecycleReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action) {
      switch (action.type) {
        case loadWorkspacesRequested.type:
          refreshWorkspaces();
          break;
        case ensureWorkspaceTasksLoaded.type: {
          const wsId = wsIdOf(action);
          if (wsId) ensureTasks(wsId);
          break;
        }
        case loadEventsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshEvents(wsId);
          break;
        }
        case loadSkillsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshSkills(wsId);
          break;
        }
        case refreshScripts.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshWorkspaceScripts(wsId);
          break;
        }
        case refreshPRStatusRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshPrStatus(wsId);
          break;
        }
      }
    }
    return result;
  };
}

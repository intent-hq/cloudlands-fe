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
 * Scope note — triggers handled elsewhere or deliberately deferred:
 *   `fetchEditors`, `loadKnownRepos`, `loadGithubRepos`,
 *   `refreshAcceptChangesStatus`, and the `workspaceMounted` fan-out are NOT
 *   AppClient-seam backed (raw IPC / fan-out only), so they live in the
 *   companion `lifecycle-ipc-read-service` instead. `initContextForWorkspace`
 *   and `hydrateTaskAgentAssociationsRequested` used to live over there too
 *   when the workspace `context` slice + `taskAgentAssociations` slice were
 *   persisted in FE `localStorage`; they moved here once the daemon owned
 *   both stores (`workspace.getContext` / `task.listAgentLinks`, PROTOCOL
 *   §5.1 / §5.4). `workspaceMounted`
 *   re-dispatches the per-workspace triggers a fresh mount needs (tasks/events/
 *   accept-changes/scripts/skills/PR status/agents/terminals/file-explorer),
 *   reusing the same handlers — no fetch logic of its own.
 *
 *   `refreshRequested` / `loadWorkspaceDataRequested` (changes) are restored
 *   here now that the live client reads the daemon file-tracking surface
 *   (`file-tracking.getChanges` / `file-tracking.loadCommits`, PROTOCOL §5.19)
 *   instead of the formerly-empty `git.*` placeholders. `requestAgentLineStats`
 *   is likewise served from the §5.20 metrics read (`metrics.getAgentStats`)
 *   via the line-changes client — the daemon owns aggregation; the FE only
 *   reads.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
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
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from "../slices/workspace-tasks/workspace-tasks-slice";
import { eventsLoaded, loadEventsRequested } from "../slices/workspace-events/workspace-events-slice";
import {
  fetchWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from "../slices/token-usage/token-usage-slice";
import {
  hydrateContextItems,
  initContextForWorkspace,
} from "../slices/context/context-slice";
import {
  hydrateTaskAgentAssociations,
  hydrateTaskAgentAssociationsRequested,
} from "../slices/task-agent-associations/task-agent-associations-slice";
import { loadSkillsRequested, setSkills } from "../slices/skills/skills-slice";
import { refreshScripts, setScriptsData, setScriptsInitialized } from "../slices/scripts/scripts-slice";
import {
  prStatusRefreshCompleted,
  prStatusRefreshStarted,
  refreshPRStatusRequested,
} from "../slices/pr-status/pr-status-slice";
import { prBranchLookupSucceeded } from "../slices/pr-branch-lookup/pr-branch-lookup-slice";
import type { PrBranchLookupPayload } from "../slices/pr-branch-lookup/pr-branch-lookup-types";
import {
  agentLineStatsRequestFailed,
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  appendOlderCommits,
  loadOlderCommitsRequested,
  loadWorkspaceDataRequested,
  refreshRequested,
  requestAgentLineStats,
  setChangesData,
  setCommitsData,
  setHasLoadedInitialData,
  setLoadingOlderCommits,
  updateAgentStats,
} from "../slices/changes/changes-slice";
import { getAgentLineStats } from "$features/line-changes/line-changes.client";
import { isAgentDeletionPending } from "$features/agent/utils/pending-agent-deletions";
import {
  STALE_RUNTIME_FLAG_CLEAR_OPTIONS,
  staleRuntimeFlagClearUpsertOptions,
} from "$features/agent/utils/stale-runtime-flag-clear";
import {
  bulkUpsertSessions,
  upsertSession,
} from "../slices/agent-session/agent-session-slice";
import {
  hydrateAgentsRequested,
  setActiveAgentId,
  setAgents,
  setAgentsLoaded,
} from "../slices/workspace-agents/workspace-agents-slice";
import {
  hydrateTerminalsRequested,
  loadWorkspaceTerminals,
} from "../slices/terminals/terminals-slice";
import {
  workspaceDeleted,
  workspaceUnmounted,
} from "../slices/workspace-lifecycle/workspace-lifecycle-slice";

const logger = createLogger("LifecycleReadService");

/** In-flight refreshes keyed by `domain:wsId`; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/** Run `fn` deduped by `key`, swallowing errors so a failed read leaves state intact. */
function coalesce(key: string, fn: () => Promise<void>): void {
  const pending = inFlight.get(key);
  if (pending) return;
  // `let` + late assign: the finally closure references `run` before the
  // initializer completes, which TS rejects as a self-referencing `const`.
  let run: Promise<void> | undefined;
  // eslint-disable-next-line prefer-const
  run = (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Refresh failed for ${key}`, error);
    } finally {
      // Only clear the slot this run still owns — an invalidation
      // (`invalidateAgentsHydration`) may have deleted it and a newer run may
      // already occupy the key; deleting blindly would drop that run's dedup.
      if (inFlight.get(key) === run) inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
}

/**
 * Per-workspace agent-hydration generation. `workspaceDeleted` (real delete or
 * the recycled-ID purge in daemon-events-bridge) bumps it and evicts the
 * in-flight `agents:{wsId}` entry, so (a) a purge-then-rehydrate is never
 * coalesced away behind a pre-purge fetch, and (b) a pre-purge response that
 * resolves late is discarded instead of resurrecting stale agents.
 */
const agentsHydrationGeneration = new Map<string, number>();

/** Bump the generation and evict the in-flight fetch for `wsId`'s agent list. */
function invalidateAgentsHydration(wsId: string): void {
  agentsHydrationGeneration.set(wsId, (agentsHydrationGeneration.get(wsId) ?? 0) + 1);
  inFlight.delete(`agents:${wsId}`);
}

/** Re-fetch the workspace list + recency (mirrors workspaces-seeder, data only). */
function refreshWorkspaces(): void {
  coalesce("workspaces", async () => {
    const workspaces = await appClient.workspaces.list({ includeArchived: true });
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
    const { tasks, stats } = await appClient.tasks.list(wsId);
    appStore.dispatch(loadWorkspaceTasksSucceeded(wsId, tasks, stats));
  });
}

/** Force-refetch tasks (no guard) for live updates when tasks change. */
function refreshTasks(wsId: string): void {
  coalesce(`tasks:${wsId}`, async () => {
    const { tasks, stats } = await appClient.tasks.list(wsId);
    appStore.dispatch(loadWorkspaceTasksSucceeded(wsId, tasks, stats));
  });
}

/** Re-fetch the workspace event stream (mirrors misc-ui-events-seeder). */
function refreshEvents(wsId: string): void {
  coalesce(`events:${wsId}`, async () => {
    const events = await appClient.events.list(wsId);
    appStore.dispatch(eventsLoaded(wsId, events));
  });
}

/**
 * Workspace IDs already hydrated from the daemon; skips repeat fetches so
 * `initContextForWorkspace` (dispatched by the ContextPanel mount and the
 * workspaceMounted fan-out) does not clobber in-memory edits with a stale
 * refetch. Cross-window updates flow via `workspace:context-changed` events.
 */
const initializedContextWorkspaces = new Set<string>();

/**
 * Hydrate a workspace's chat-context items from the daemon
 * (`workspace.getContext`, PROTOCOL §5.1) exactly once. The daemon is
 * authoritative, so an empty list still dispatches `hydrateContextItems` —
 * that resets any stale in-memory state accumulated before the read landed
 * and matches what the workspace looks like after this reconciliation. The
 * daemon-events bridge folds subsequent updates via the same reducer.
 */
function hydrateWorkspaceContext(wsId: string): void {
  if (initializedContextWorkspaces.has(wsId)) return;
  coalesce(`context:${wsId}`, async () => {
    if (initializedContextWorkspaces.has(wsId)) return;
    const items = await appClient.workspaces.getContext(wsId);
    appStore.dispatch(hydrateContextItems(wsId, Array.isArray(items) ? items : []));
    initializedContextWorkspaces.add(wsId);
  });
}

/**
 * Hydrate a workspace's task↔agent linkage map from the daemon
 * (`task.listAgentLinks`, PROTOCOL §5.4). The daemon returns the pre-grouped
 * `byNoteId → byTaskKey` shape, so the live client hands it straight to
 * `hydrateTaskAgentAssociations`. `task:agent-linked`/`task:agent-unlinked`
 * events (§6.5) drive incremental updates from the bridge afterwards.
 */
function hydrateWorkspaceTaskAgentAssociations(wsId: string): void {
  coalesce(`taskAgentLinks:${wsId}`, async () => {
    const byNoteId = await appClient.tasks.listAgentLinks(wsId);
    appStore.dispatch(hydrateTaskAgentAssociations(wsId, byNoteId));
  });
}

/**
 * Fetch the daemon-owned token usage rollup (`workspace.getTokenUsage`,
 * PROTOCOL §5.23). A `null` result (unknown workspace) or a failed read marks
 * the cached numbers stale; pushes arrive separately via the
 * `workspace:tokenUsage-changed` handler in daemon-events-bridge.
 */
function refreshTokenUsage(wsId: string): void {
  coalesce(`tokenUsage:${wsId}`, async () => {
    try {
      const usage = await appClient.workspaces.getTokenUsage(wsId);
      if (usage) {
        appStore.dispatch(tokenUsageReceived(wsId, usage));
      } else {
        appStore.dispatch(tokenUsageFetchFailed(wsId));
      }
    } catch (error) {
      appStore.dispatch(tokenUsageFetchFailed(wsId));
      throw error;
    }
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

/**
 * Force daemon-side PR discovery/refresh + branch lookup (`pr.refresh`,
 * PROTOCOL §5.7 extension). Unlike the bare `pr.status` read this used to
 * issue, `pr.refresh` runs the daemon's shared refresh path (discovery by head
 * branch, relink-after-merge, stale-link clearing), so a refresh click
 * surfaces newly created PRs. The daemon emits `pr:linked` / `pr:updated` /
 * `pr:unlinked` on change; the events bridge folds those into the workspace
 * entity — this handler only reports completion and the branch lookup.
 */
function refreshPrStatus(wsId: string): void {
  coalesce(`prStatus:${wsId}`, async () => {
    appStore.dispatch(prStatusRefreshStarted(wsId));
    try {
      const refresh = await appClient.git.prRefresh(wsId);
      // The seam folds transport/daemon errors to null (a no-PR refresh still
      // returns a result with empty linkage fields), so null means the refresh
      // itself failed — report it instead of a phantom success.
      if (refresh === null) {
        appStore.dispatch(prStatusRefreshCompleted(wsId, false, "pr.refresh failed"));
        return;
      }
      appStore.dispatch(prStatusRefreshCompleted(wsId, true));
      const workspace = getItem(appStore.state.workspace.workspaces, wsId as Workspace["id"]);
      const owner = workspace?.repositoryOwner;
      const repo = workspace?.repositoryName;
      if (refresh?.prNumber != null && owner && repo) {
        const payload: PrBranchLookupPayload = {
          owner,
          repo,
          prNumber: refresh.prNumber,
          key: `${owner}/${repo}#${refresh.prNumber}`,
        };
        appStore.dispatch(prBranchLookupSucceeded(payload, workspace.branch));
      }
    } catch (error) {
      appStore.dispatch(prStatusRefreshCompleted(wsId, false, error instanceof Error ? error.message : String(error)));
    }
  });
}

/**
 * Re-fetch tracked changes + commit history from the daemon file-tracking
 * reads (§5.19, mirrors the files-git-seeder changes section) so the changes
 * panel refresh/init triggers converge the store from BE state.
 */
function refreshChanges(wsId: string): void {
  coalesce(`changes:${wsId}`, async () => {
    const [changes, commitsEnvelope] = await Promise.all([
      appClient.git.trackedChanges(wsId),
      appClient.git.commitsWithBoundary(wsId),
    ]);
    appStore.dispatch(setChangesData(wsId, changes, false, changes.length));
    appStore.dispatch(setCommitsData(wsId, commitsEnvelope.commits, commitsEnvelope.boundarySha));
    appStore.dispatch(setHasLoadedInitialData(wsId, true));
  });
}

/**
 * Load older commits (pre-boundary) for the "show previous" toggle in the
 * Changes panel. Calls the daemon with `includeOlder: true` and dispatches
 * the results into `olderCommits`.
 *
 * @param wsId - Workspace ID
 * @param _beforeSha - Optional SHA to use as pagination anchor (from boundarySha or last older commit) [NOT YET USED]
 * @param _limit - Optional limit on commit count (defaults to daemon-side default) [NOT YET USED]
 */
function loadOlderCommits(wsId: string, _beforeSha?: string, _limit?: number): void {
  // Note: _beforeSha and _limit are currently not forwarded to the daemon API
  // because the wire shape (§5.19 file-tracking.loadCommits) only supports
  // { workspaceId, includeOlder }. When pagination support is added to the
  // wire, this handler will forward these params.
  coalesce(`olderCommits:${wsId}`, async () => {
    appStore.dispatch(setLoadingOlderCommits(wsId, true));
    try {
      const envelope = await appClient.git.commitsWithBoundary(wsId, true);
      appStore.dispatch(appendOlderCommits(wsId, envelope.commits));
    } finally {
      appStore.dispatch(setLoadingOlderCommits(wsId, false));
    }
  });
}

/**
 * Fetch one agent's §5.20 line-change totals (`metrics.getAgentStats`) into
 * the changes slice. Skips when a request is in flight or stats are already
 * present (unless forced) — AgentPeekCard dispatches from a mount effect.
 */
function refreshAgentLineStats(agentId: string, forceRefresh: boolean): void {
  const requestState = appStore.state.changes.agentLineStatsRequests[agentId];
  if (requestState?.isLoading) return;
  if (!forceRefresh && appStore.state.changes.agentStats[agentId]) return;
  coalesce(`agentLineStats:${agentId}`, async () => {
    appStore.dispatch(agentLineStatsRequestStarted(agentId, new Date().toISOString()));
    try {
      const metrics = await getAgentLineStats(agentId);
      if (metrics) {
        appStore.dispatch(
          updateAgentStats(agentId, {
            additions: metrics.additions,
            deletions: metrics.deletions,
            timestamp: new Date().toISOString(),
          }),
        );
      }
      appStore.dispatch(agentLineStatsRequestSucceeded(agentId, new Date().toISOString()));
    } catch (error) {
      appStore.dispatch(
        agentLineStatsRequestFailed(
          agentId,
          error instanceof Error ? error.message : String(error),
          new Date().toISOString(),
        ),
      );
    }
  });
}

/**
 * Hydrate a workspace's agent list on mount, mirroring the boot `agents-seeder`
 * for this workspace only. Always refetches `agents.list` — a stale-skip guard
 * on `agentsLoaded` previously let a recycled workspace ID keep the previous
 * workspace's agents — and converges through the `setAgents` reconcile path.
 * User-driven state is preserved: the active agent is only (re)selected when
 * none is set or the current one is no longer known, so a re-mount of an
 * unchanged workspace never clobbers the user's selection.
 *
 * Two staleness guards (see LEAK-1 review):
 * - `agent.list` returns AgentLite (PROTOCOL §5.5) — metadata with `messages`
 *   normalized to `[]`, never the retained transcript. Upserting the snapshot
 *   as-is would truncate a transcript that `chat-read-service` /
 *   `agent-read-service` already hydrated, so any existing messages are
 *   preserved (same merge `ensureAgentSession` uses).
 * - The hydration generation captured before the fetch is re-checked after it
 *   resolves; a `workspaceDeleted` purge in between discards the response so a
 *   pre-purge fetch can never merge stale agents back after the purge.
 * - Agents with a pending soft-hidden deletion (undo window still open, so the
 *   daemon still lists them) are dropped from the response — re-adding them
 *   would resurrect a deleted agent whenever another agent's lifecycle event
 *   triggers a rehydrate.
 */
function hydrateWorkspaceAgents(wsId: string): void {
  const generation = agentsHydrationGeneration.get(wsId) ?? 0;
  coalesce(`agents:${wsId}`, async () => {
    // Capture BEFORE the fetch (monorepo#1250): agents whose both-true
    // runtime-flag pair already exists when this read begins are either
    // genuinely live (the fresh snapshot reports the turn in flight) or a
    // stale leftover from a daemon crash mid-turn (the snapshot reports
    // idle). A pair set DURING the fetch (chatSendStarted racing this read)
    // keeps the slice pair-guard's default preservation semantics.
    const sessionsBefore = appStore.state.agentSessions?.byAgentId ?? {};
    const hadInFlightPairBeforeFetch = (agentId: string): boolean => {
      const stored = sessionsBefore[agentId];
      return stored?.isStreaming === true && stored?.isProcessing === true;
    };
    const listed = await appClient.agents.list(wsId);
    if ((agentsHydrationGeneration.get(wsId) ?? 0) !== generation) return;
    const fetched = listed.filter((agent) => !isAgentDeletionPending(String(agent.id)));
    appStore.dispatch(setAgentsLoaded(wsId, true));
    if (fetched.length === 0) return;
    const agents = fetched.map((agent) => {
      const existing = appStore.state.agentSessions?.byAgentId[String(agent.id)];
      return agent.messages.length === 0 && existing && existing.messages.length > 0
        ? { ...agent, messages: existing.messages }
        : agent;
    });
    appStore.dispatch(setAgents(wsId, agents));
    // Stale-pair convergence (monorepo#1250): bulk-upsert options apply to
    // the whole batch, so partition — agents whose pre-fetch stale pair meets
    // an authoritatively idle snapshot get the clear options; everything else
    // keeps the default pair-guard preservation semantics.
    const staleClearAgents = agents.filter(
      (agent) =>
        staleRuntimeFlagClearUpsertOptions(hadInFlightPairBeforeFetch(String(agent.id)), agent) !==
        undefined,
    );
    const defaultAgents = agents.filter((agent) => !staleClearAgents.includes(agent));
    if (defaultAgents.length > 0) {
      appStore.dispatch(bulkUpsertSessions(defaultAgents));
    }
    if (staleClearAgents.length > 0) {
      appStore.dispatch(bulkUpsertSessions(staleClearAgents, STALE_RUNTIME_FLAG_CLEAR_OPTIONS));
    }
    for (const agent of agents) {
      appStore.dispatch(upsertSession(agent));
    }
    const workspaceState = appStore.state.workspaceAgents.byWorkspaceId[wsId];
    const activeAgentId = workspaceState?.activeAgentId;
    if (activeAgentId && (workspaceState?.agentIds ?? []).includes(activeAgentId)) {
      return;
    }
    const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
    appStore.dispatch(setActiveAgentId(wsId, String(firstForeground.id)));
  });
}

/**
 * Hydrate a workspace's terminals on mount, mirroring the boot
 * `terminals-scripts-seeder` terminal section. A successful non-empty fetch
 * dispatches `loadWorkspaceTerminals` to converge the store; an empty list
 * over existing live tabs converges to zero tabs only when the envelope's
 * `daemonBootId` matches the boot that owned them (authoritative same-boot
 * empty) — a restart/legacy/unknown-boot empty preserves the tabs
 * (monorepo#1330/#1334), which then respawn via auto-reconnect. A failed
 * fetch is swallowed by the coalesce wrapper and leaves prior tab state
 * intact, so transient errors during workspace switches do NOT clobber live
 * terminals (STAB-24).
 */
function hydrateWorkspaceTerminals(wsId: string): void {
  coalesce(`terminals:${wsId}`, async () => {
    const { terminals, daemonBootId } = await appClient.terminals.list(wsId);
    appStore.dispatch(loadWorkspaceTerminals(wsId, terminals, undefined, daemonBootId));
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
        case loadWorkspaceTasksRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshTasks(wsId);
          break;
        }
        case loadEventsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshEvents(wsId);
          break;
        }
        case fetchWorkspaceTokenUsage.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshTokenUsage(wsId);
          break;
        }
        case initContextForWorkspace.type: {
          const wsId = wsIdOf(action);
          if (wsId) hydrateWorkspaceContext(wsId);
          break;
        }
        case hydrateTaskAgentAssociationsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) hydrateWorkspaceTaskAgentAssociations(wsId);
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
        case refreshRequested.type:
        case loadWorkspaceDataRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) refreshChanges(wsId);
          break;
        }
        case loadOlderCommitsRequested.type: {
          // loadOlderCommitsRequested uses an object payload: { wsId, beforeSha, limit }
          const payload = (action as { payload?: { wsId?: unknown; beforeSha?: unknown; limit?: unknown } }).payload;
          const wsId = typeof payload?.wsId === "string" ? payload.wsId : undefined;
          const beforeSha = typeof payload?.beforeSha === "string" ? payload.beforeSha : undefined;
          const limit = typeof payload?.limit === "number" ? payload.limit : undefined;
          if (wsId) loadOlderCommits(wsId, beforeSha, limit);
          break;
        }
        case requestAgentLineStats.type: {
          const payload = (
            action as { payload?: { agentId?: unknown; forceRefresh?: unknown } }
          ).payload;
          const agentId =
            typeof payload?.agentId === "string" && payload.agentId.length > 0
              ? payload.agentId
              : undefined;
          if (agentId) refreshAgentLineStats(agentId, payload?.forceRefresh === true);
          break;
        }
        case hydrateAgentsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) hydrateWorkspaceAgents(wsId);
          break;
        }
        // Purge (real delete or the bridge's recycled-ID create) invalidates
        // any in-flight agent-list fetch so the follow-up rehydrate is neither
        // coalesced away nor overwritten by a stale pre-purge response. It
        // also drops the once-per-workspace context-init flag: the context
        // slice clears its own state on delete via the workspace-scoped
        // reducers, so a subsequent mount must be free to re-hydrate.
        case workspaceDeleted.type: {
          const wsId = wsIdOf(action);
          if (wsId) {
            invalidateAgentsHydration(wsId);
            initializedContextWorkspaces.delete(wsId);
          }
          break;
        }
        // Session-end cleanup: the context slice clears the workspace's items
        // on `workspaceUnmounted`, so drop the once-per-workspace init flag
        // too — otherwise a remount of the same workspace id would skip the
        // `workspace.getContext` refetch and stay empty until an event
        // arrives.
        case workspaceUnmounted.type: {
          const wsId = wsIdOf(action);
          if (wsId) initializedContextWorkspaces.delete(wsId);
          break;
        }
        case hydrateTerminalsRequested.type: {
          const wsId = wsIdOf(action);
          if (wsId) hydrateWorkspaceTerminals(wsId);
          break;
        }
      }
    }
    return result;
  };
}

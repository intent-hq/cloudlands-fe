/**
 * Agent subscription read service — populates the agent-subscription-ui slice
 * from the daemon's `agent.getSubscriptions` (PROTOCOL §5.5 extensions).
 *
 * `requestSubscriptionFetch` (dispatched by AgentSubscriptions.svelte on mount /
 * agent switch) lost its consumer when the saga runtime was removed. Like the
 * other read services, `createAgentSubscriptionReadMiddleware()` restores the
 * read path WITHOUT re-adding a saga and WITHOUT changing any call site: it
 * observes dispatched actions and, on `requestSubscriptionFetch`, fetches the
 * completion-watch payload over the live transport and dispatches
 * `setSubscriptionSnapshot` with the mapped slice shape.
 *
 * Wire mapping (`{ subscriptions, delegationGroups, agentStatuses }`):
 * - subscriptions map field-for-field onto the slice `Subscription` shape (the
 *   wire payload is a superset carrying `agentName`/`workspaceId`/`oneShot`).
 * - `DelegationGroupStatus.agentStatuses` has no per-group wire field; it is
 *   derived (safe derivation, not fabrication) by filtering the top-level
 *   `agentStatuses` map to the group's `expectedAgentIds`.
 * - `waitingState` is derived from snapshot deltas, mirroring the reference
 *   saga semantics: data present → `waiting`; empty → `idle`; empty while the
 *   previous state was `waiting`/`woken` → `completed` (the daemon removes the
 *   group + its watches when the aggregated wake delivers, so "went empty" IS
 *   the delivery signal). A `completed` entry is reset after
 *   `COMPLETED_DISPLAY_DURATION_MS`, unless new active data arrived meanwhile
 *   (the cleanup re-fetches before resetting, generation-guarded so a newer
 *   completion supersedes a stale timer).
 *
 * Live ticking: the daemon-events-bridge calls
 * `refreshWorkspaceSubscriptionEntries` on the agent-lifecycle events that feed
 * the daemon's fan-in (`agent:idle` / `agent:failed` / `agent:deleted` /
 * `agent:created`), refreshing every tracked entry in that workspace. Events
 * carry the CHILD agent id while entries are keyed by the watching PARENT, and
 * a fresh delegation may not be referenced by the parent's entry yet — so the
 * refresh fans out to all tracked entries instead of matching ids (entries are
 * few: only agents whose subscription row was rendered).
 *
 * LEAK-1 (workspace switches / recycled ids): `workspaceDeleted` — dispatched
 * by the bridge for both real deletes and the recycled-ID purge — bumps the
 * per-workspace hydration generation, evicts in-flight fetches, and resets
 * every entry of that workspace. A pre-purge fetch that resolves late is
 * discarded (generation re-checked after the await) so stale "Waiting for N
 * agents" rows can never leak into a recreated workspace.
 *
 * Dependency-light per src/store AGENTS.md: imports only the live transport,
 * the configured store, slice actions/types, and the logger (NOT selectors).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { backendRequest } from "$lib/client/live/backend-transport";
import { store as appStore } from "$store/renderer/store";
import {
  makeKey,
  requestSubscriptionFetch,
  resetSubscriptionUI,
  setSubscriptionSnapshot,
} from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice";
import {
  workspaceDeleted,
  workspaceUnmounted,
} from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import type {
  AgentStatus,
  AgentSubscriptionUIEntry,
  DelegationGroupStatus,
  Subscription,
  WaitingState,
} from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AgentSubscriptionReadService");

/** How long a `completed` entry is displayed before it is reset. */
export const COMPLETED_DISPLAY_DURATION_MS = 3000;

// ---------------------------------------------------------------------------
// Wire shapes (`agent.getSubscriptions`, PROTOCOL §5.5 extensions)
// ---------------------------------------------------------------------------

interface WireDelegationGroupInfo {
  groupId: string;
  awaitMode: "all";
  expectedAgentIds: string[];
}

interface WireSubscription {
  id: string;
  agentId: string;
  createdAt: string;
  actorIds: string[];
  eventTypes: string[];
  delegationGroup?: WireDelegationGroupInfo | null;
  description: string;
}

interface WireDelegationGroup {
  groupId: string;
  awaitMode: "all";
  expectedAgentIds: string[];
  completedAgentIds: string[];
  deletedAgentIds: string[];
  delivered: boolean;
}

interface WireGetSubscriptionsResult {
  subscriptions?: WireSubscription[];
  delegationGroups?: WireDelegationGroup[];
  agentStatuses?: Record<string, AgentStatus>;
}

function mapSubscription(wire: WireSubscription): Subscription {
  return {
    id: wire.id,
    agentId: wire.agentId,
    eventTypes: wire.eventTypes,
    actorIds: wire.actorIds,
    createdAt: wire.createdAt,
    description: wire.description,
    ...(wire.delegationGroup
      ? {
          delegationGroup: {
            groupId: wire.delegationGroup.groupId,
            awaitMode: wire.delegationGroup.awaitMode,
            expectedAgentIds: wire.delegationGroup.expectedAgentIds,
          },
        }
      : {}),
  };
}

function mapDelegationGroup(
  wire: WireDelegationGroup,
  agentStatuses: Record<string, AgentStatus>,
): DelegationGroupStatus {
  const groupStatuses: Record<string, AgentStatus> = {};
  for (const id of wire.expectedAgentIds) {
    const status = agentStatuses[id];
    if (status) groupStatuses[id] = status;
  }
  return {
    groupId: wire.groupId,
    awaitMode: wire.awaitMode,
    expectedAgentIds: wire.expectedAgentIds,
    completedAgentIds: wire.completedAgentIds,
    deletedAgentIds: wire.deletedAgentIds,
    agentStatuses: groupStatuses,
    delivered: wire.delivered,
  };
}

// ---------------------------------------------------------------------------
// Fetch + snapshot dispatch
// ---------------------------------------------------------------------------

/** In-flight fetches keyed by `${wsId}:${agentId}`; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Per-workspace hydration generation (LEAK-1). Bumped by the `workspaceDeleted`
 * purge so a pre-purge fetch that resolves late is discarded instead of
 * resurrecting a stale entry.
 */
const workspaceGeneration = new Map<string, number>();

/**
 * Per-entry completion generation: a newer `completed` transition invalidates a
 * stale cleanup timer so it never resets the newer indicator early.
 */
const completionGeneration = new Map<string, number>();
let nextCompletionGeneration = 1;

function currentWorkspaceGeneration(wsId: string): number {
  return workspaceGeneration.get(wsId) ?? 0;
}

function readEntries(): Record<string, AgentSubscriptionUIEntry> {
  const state = appStore.state as {
    agentSubscriptionUI?: { entries: Record<string, AgentSubscriptionUIEntry> };
  };
  return state.agentSubscriptionUI?.entries ?? {};
}

/**
 * Fetch one agent's completion-watch payload and converge the slice. Errors are
 * swallowed (logged only) so a failed read leaves the prior entry intact;
 * concurrent calls for the same (workspace, agent) share one fetch.
 */
export function fetchAgentSubscriptionSnapshot(wsId: string, agentId: string): Promise<void> {
  const key = makeKey(wsId, agentId);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const generation = currentWorkspaceGeneration(wsId);
  // `let` + late assign: the finally closure references `run` before the
  // initializer completes, which TS rejects as a self-referencing `const`.
  let run: Promise<void> | undefined;
  // eslint-disable-next-line prefer-const
  run = (async () => {
    try {
      const previousWaitingState: WaitingState = readEntries()[key]?.waitingState ?? "idle";
      const result = await backendRequest<WireGetSubscriptionsResult>("agent.getSubscriptions", {
        workspaceId: wsId,
        agentId,
      });
      if (currentWorkspaceGeneration(wsId) !== generation) return;

      const agentStatuses = result?.agentStatuses ?? {};
      const subscriptions = (result?.subscriptions ?? []).map(mapSubscription);
      const delegationGroups = (result?.delegationGroups ?? []).map((group) =>
        mapDelegationGroup(group, agentStatuses),
      );
      const hasData = subscriptions.length > 0 || delegationGroups.length > 0;

      // Transition: was waiting/woken but now empty → the group delivered its
      // wake (the daemon drops delivered groups + watches) → show "completed".
      if (!hasData && (previousWaitingState === "waiting" || previousWaitingState === "woken")) {
        appStore.dispatch(
          setSubscriptionSnapshot(wsId, agentId, {
            subscriptions,
            delegationGroups,
            agentStatuses,
            waitingState: "completed",
          }),
        );
        scheduleCompletedCleanup(wsId, agentId, generation);
        return;
      }

      appStore.dispatch(
        setSubscriptionSnapshot(wsId, agentId, {
          subscriptions,
          delegationGroups,
          agentStatuses,
          waitingState: hasData ? "waiting" : "idle",
        }),
      );
    } catch (error) {
      logger.error(`Failed to fetch agent subscriptions for ${key}`, error);
    } finally {
      if (inFlight.get(key) === run) inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

/**
 * After the display window, reset the `completed` entry — unless a newer
 * completion took over the generation, the workspace was purged, or new active
 * data arrived during the window (verified by a fresh re-fetch, in which case
 * the entry is refreshed instead of reset).
 */
function scheduleCompletedCleanup(wsId: string, agentId: string, generation: number): void {
  const key = makeKey(wsId, agentId);
  const gen = nextCompletionGeneration;
  nextCompletionGeneration += 1;
  completionGeneration.set(key, gen);
  setTimeout(() => {
    void (async () => {
      if (completionGeneration.get(key) !== gen) return;
      completionGeneration.delete(key);
      if (currentWorkspaceGeneration(wsId) !== generation) return;
      try {
        const fresh = await backendRequest<WireGetSubscriptionsResult>("agent.getSubscriptions", {
          workspaceId: wsId,
          agentId,
        });
        if (currentWorkspaceGeneration(wsId) !== generation) return;
        if ((fresh?.subscriptions?.length ?? 0) > 0 || (fresh?.delegationGroups?.length ?? 0) > 0) {
          void fetchAgentSubscriptionSnapshot(wsId, agentId);
          return;
        }
      } catch {
        // Re-fetch failed — the original snapshot already showed empty data,
        // so proceed with the reset.
      }
      appStore.dispatch(resetSubscriptionUI(wsId, agentId));
    })();
  }, COMPLETED_DISPLAY_DURATION_MS);
}

// ---------------------------------------------------------------------------
// Event-triggered refresh + workspace purge (called by daemon-events-bridge /
// the middleware below)
// ---------------------------------------------------------------------------

/**
 * Refresh every tracked subscription entry in `wsId` (see file header for why
 * the fan-out does not match on the event's agent id). Fetches are coalesced
 * per entry, so bursts of lifecycle events collapse into one read each.
 */
export function refreshWorkspaceSubscriptionEntries(wsId: string): void {
  const prefix = `${wsId}:`;
  for (const key of Object.keys(readEntries())) {
    if (!key.startsWith(prefix)) continue;
    void fetchAgentSubscriptionSnapshot(wsId, key.slice(prefix.length));
  }
}

/**
 * LEAK-1 purge: bump the hydration generation (discarding in-flight and
 * late-resolving fetches plus pending completion timers) and reset every entry
 * of the deleted workspace.
 */
export function purgeWorkspaceSubscriptionEntries(wsId: string): void {
  workspaceGeneration.set(wsId, currentWorkspaceGeneration(wsId) + 1);
  const prefix = `${wsId}:`;
  for (const key of completionGeneration.keys()) {
    if (key.startsWith(prefix)) completionGeneration.delete(key);
  }
  for (const key of Object.keys(readEntries())) {
    if (!key.startsWith(prefix)) continue;
    inFlight.delete(key);
    appStore.dispatch(resetSubscriptionUI(wsId, key.slice(prefix.length)));
  }
}

/**
 * `workspaceUnmounted` housekeeping: drop pending completion generations for
 * the workspace so the maps never grow unbounded across mount/unmount cycles
 * (a remount re-fetches via the component's `requestSubscriptionFetch`).
 */
function pruneWorkspaceGenerations(wsId: string): void {
  const prefix = `${wsId}:`;
  for (const key of completionGeneration.keys()) {
    if (key.startsWith(prefix)) completionGeneration.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware that gives `requestSubscriptionFetch` a real handler and hooks the
 * LEAK-1 purge into `workspaceDeleted`. Fire-and-forget — dispatch stays
 * synchronous and never throws.
 */
export function createAgentSubscriptionReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    if (action.type === requestSubscriptionFetch.type) {
      const [wsId, agentId] = (action.payload ?? []) as [string?, string?];
      if (typeof wsId === "string" && wsId && typeof agentId === "string" && agentId) {
        void fetchAgentSubscriptionSnapshot(wsId, agentId);
      }
    } else if (action.type === workspaceDeleted.type) {
      const [wsId] = (action.payload ?? []) as [string?];
      if (typeof wsId === "string" && wsId) purgeWorkspaceSubscriptionEntries(wsId);
    } else if (action.type === workspaceUnmounted.type) {
      const [wsId] = (action.payload ?? []) as [string?];
      if (typeof wsId === "string" && wsId) pruneWorkspaceGenerations(wsId);
    }
    return result;
  };
}

/** @internal Reset module-level maps between tests. */
export function __resetAgentSubscriptionReadServiceForTests(): void {
  inFlight.clear();
  workspaceGeneration.clear();
  completionGeneration.clear();
  nextCompletionGeneration = 1;
}

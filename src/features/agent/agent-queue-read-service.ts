/**
 * Agent queue read service — the reconciliation fallback for the renderer's
 * queued-messages mirror (monorepo#1749).
 *
 * The agentQueue slice is normally a pure event mirror: `agent:queue:updated`
 * snapshots are folded via `replaceAgentQueue` by the daemon-events-bridge.
 * A single missed event (reconnect gap, event arriving before the bridge
 * re-subscribed, burst drop) would otherwise leave a drained entry rendered
 * forever, since no other writer can shrink the queue. `hydrateAgentQueue`
 * re-reads the authoritative queue via `agent.getQueue` (PROTOCOL §5.5/§6.6)
 * and folds it through the SAME `replaceAgentQueue` reducer, so the
 * recently-removed-id tombstone suppression applies identically to hydrated
 * and event-mirrored snapshots.
 *
 * Callers: ChatPanel dispatches a hydrate on mount and on workspace rebind
 * (alongside `initializeChatRequested`), and the daemon-events-bridge hydrates
 * the active agent on reconnect (alongside the RESUB-1 replay). The
 * `agent:queue:updated` event remains the live update path.
 *
 * Single-flight with trailing coalesce per agentId (AGENTS.md "Event-driven
 * refetches — single-flight and coalesced"): a burst of triggers produces at
 * most one immediate `agent.getQueue` plus at most one trailing follow-up —
 * never one independent fetch per trigger, since unordered resolution could
 * let a stale response that resolves last overwrite a newer snapshot.
 *
 * Errors are swallowed (logged + surfaced via `setAgentQueueError`) so a
 * failed read leaves the prior mirror intact rather than clearing it.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions, and the logger (NOT selectors).
 */
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  hydrateAgentQueueRequested,
  replaceAgentQueue,
  setAgentQueueError,
  setAgentQueueHydrating,
} from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from './utils/pending-agent-deletions';

const logger = createLogger('AgentQueueReadService');

/** Shared in-flight hydrate chain per agent (leading fetch + any trailing follow-up). */
const hydrateInFlightByAgent = new Map<string, Promise<void>>();
/** Agents whose in-flight fetch should be followed by exactly one re-fetch. */
const hydrateFollowUpWantedByAgent = new Set<string>();
/** Per-agent counter of live `agent:queue:updated` snapshots applied. */
const eventSnapshotSeqByAgent = new Map<string, number>();

/**
 * Record that a live `agent:queue:updated` snapshot was folded into the
 * mirror. Called by the daemon-events-bridge alongside its
 * `replaceAgentQueue` dispatch. An in-flight hydrate fetch that started
 * before this event discards its response: queue changes always emit an
 * event, so a live snapshot applied mid-flight is at least as fresh as the
 * RPC response — folding the older response afterward could re-add a
 * just-drained row or drop a just-queued one.
 */
export function noteAgentQueueEventSnapshotApplied(agentId: string): void {
  eventSnapshotSeqByAgent.set(agentId, (eventSnapshotSeqByAgent.get(agentId) ?? 0) + 1);
}

/**
 * Current per-agent live-snapshot seq. Send paths capture this BEFORE their
 * wire call and skip the queued-response queue seed when it has advanced
 * (monorepo#2481): a live `agent:queue:updated` snapshot — including the
 * shrunk-after-drain one — is at least as fresh as the RPC echo, so seeding
 * from the stale echo would re-add a just-drained row.
 */
export function getAgentQueueEventSnapshotSeq(agentId: string): number {
  return eventSnapshotSeqByAgent.get(agentId) ?? 0;
}

async function runHydrateAgentQueueFetch(agentId: string): Promise<void> {
  // Trailing follow-ups re-enter here without passing the public entry
  // point's guard: skip the RPC (and the slice-entry-creating dispatch) when
  // a deletion became pending while the leading fetch was in flight.
  if (isAgentDeletionPending(agentId)) {
    hydrateFollowUpWantedByAgent.delete(agentId);
    return;
  }
  appStore.dispatch(hydrateAgentQueueRequested(agentId));
  const seqAtFetchStart = eventSnapshotSeqByAgent.get(agentId) ?? 0;
  try {
    const queue = await appClient.agents.getQueue(agentId);
    // Re-check after the fetch: a deletion may have become pending while
    // `agent.getQueue` was in flight (folding the response would resurrect
    // rows for a soft-hidden session), or a live event snapshot may have
    // superseded the response (see noteAgentQueueEventSnapshotApplied).
    if (isAgentDeletionPending(agentId)) {
      // Clear the isHydrating flag hydrateAgentQueueRequested set — nothing
      // else terminates this cycle when the fold is skipped. (In the
      // superseded case the event's replaceAgentQueue already cleared it.)
      appStore.dispatch(setAgentQueueHydrating(agentId, false));
    } else if ((eventSnapshotSeqByAgent.get(agentId) ?? 0) === seqAtFetchStart) {
      appStore.dispatch(replaceAgentQueue(agentId, queue));
    }
  } catch (error) {
    logger.error(`Failed to hydrate agent queue for ${agentId}`, error);
    if (isAgentDeletionPending(agentId)) {
      // Don't create/keep an error entry for a soft-hidden session.
      appStore.dispatch(setAgentQueueHydrating(agentId, false));
    } else {
      appStore.dispatch(
        setAgentQueueError(agentId, error instanceof Error ? error.message : String(error)),
      );
    }
  } finally {
    // Trailing coalesce: one or more triggers arrived while this fetch was in
    // flight — run exactly one follow-up fetch to pick up the latest state,
    // regardless of how many triggers piled up. Awaited so the shared
    // in-flight promise settles only when the whole chain (including
    // follow-ups queued during the trailing fetch) has finished.
    if (hydrateFollowUpWantedByAgent.delete(agentId)) {
      await runHydrateAgentQueueFetch(agentId);
    }
  }
}

/**
 * Reconcile the agentQueue mirror for one agent from the daemon's
 * authoritative `agent.getQueue`. Single-flighted with trailing coalesce per
 * agentId: the leading edge fetches immediately, and any triggers that arrive
 * while that fetch is in flight collapse into at most one trailing follow-up.
 * All coalesced callers share the in-flight chain promise, which resolves
 * once the leading fetch and any trailing follow-up have settled.
 */
export function hydrateAgentQueue(agentId: string): Promise<void> {
  // A soft-hidden deletion is pending (undo window still open): the daemon
  // still returns the agent, so hydrating would re-mirror rows for the
  // deleted session. Skip entirely.
  if (!agentId || isAgentDeletionPending(agentId)) return Promise.resolve();
  const inFlight = hydrateInFlightByAgent.get(agentId);
  if (inFlight) {
    hydrateFollowUpWantedByAgent.add(agentId);
    return inFlight;
  }
  const chain = runHydrateAgentQueueFetch(agentId).finally(() => {
    hydrateInFlightByAgent.delete(agentId);
  });
  hydrateInFlightByAgent.set(agentId, chain);
  return chain;
}

/** @internal Reset module-level single-flight state between tests. */
export function __resetAgentQueueReadServiceForTests(): void {
  hydrateInFlightByAgent.clear();
  hydrateFollowUpWantedByAgent.clear();
  eventSnapshotSeqByAgent.clear();
}

/**
 * Chat interest leases — which agents some live consumer (a mounted ChatPanel
 * instance, an in-flight chat-read hydration) currently depends on for a
 * standing `chat.subscribe` registration (intent-hq/monorepo#3295).
 *
 * The chat-subscribe saga's sweeps (viewed-agent swap, applied clear, scoped
 * clear) historically inferred "still needed" from heuristic spare sets
 * (loading flags, mid-acquisition slots) that were defeated by redux
 * flush-ordering and microtask-deferral races — the #2692/#2864/#2917/#3073/
 * #3185/#3295 strand family. Leases replace the inference with an explicit,
 * synchronously-maintained registry:
 *
 * - Each ChatPanel instance acquires a lease keyed `(agentId, instanceId)`
 *   synchronously at the TOP of its onMount — BEFORE it dispatches
 *   `chatTrackedWorkspaceSet` / `initializeChatRequested` — so the lease
 *   exists before any sibling panel's `markAgentAsViewed` sweep can run in
 *   either flush ordering. Released in onDestroy.
 * - The chat-read saga's hydration worker holds a lease (a unique holder id
 *   per hydration attempt) for the duration of a hydration, released in its
 *   finally block.
 *
 * Holders are idempotent per key: re-acquiring the same `(agentId, holderId)`
 * is a no-op, as is releasing a key that is not held. Entries are transient,
 * UI-only state (per src/store AGENTS.md) — they never enter Redux.
 *
 * Dependency-light per AGENTS.md utils conventions: no stores, services, or
 * wire calls — just a module-level Map with simple accessors over it.
 */

const leaseHoldersByAgent = new Map<string, Set<string>>();

type LastLeaseReleasedListener = (agentId: string) => void;
const lastLeaseReleasedListeners = new Set<LastLeaseReleasedListener>();

/** Record that `holderId` now depends on this agent's chat subscription. */
export function acquireChatInterestLease(agentId: string, holderId: string): void {
  let holders = leaseHoldersByAgent.get(agentId);
  if (!holders) {
    holders = new Set<string>();
    leaseHoldersByAgent.set(agentId, holders);
  }
  holders.add(holderId);
}

/** Record that `holderId` no longer depends on this agent's chat subscription. */
export function releaseChatInterestLease(agentId: string, holderId: string): void {
  const holders = leaseHoldersByAgent.get(agentId);
  if (!holders || !holders.delete(holderId)) return;
  if (holders.size === 0) {
    leaseHoldersByAgent.delete(agentId);
    // LAST-lease release: notify synchronously so the chat-subscribe saga can
    // run a deferred sweep-close the moment nothing depends on the agent —
    // including when this release comes from the chat-read saga's finally on
    // cancellation, which dispatches no settle/fail action for a revisit to
    // key on. Listeners must be cheap and non-throwing (they run inside
    // component teardown / saga finally paths).
    for (const listener of [...lastLeaseReleasedListeners]) listener(agentId);
  }
}

/**
 * Subscribe to LAST-lease releases (an agent's holder set becoming empty via
 * `releaseChatInterestLease`). Returns the unsubscribe. `clearAllChatInterestLeases`
 * (test reset / dispose) deliberately does not notify.
 */
export function onLastChatInterestLeaseReleased(listener: LastLeaseReleasedListener): () => void {
  lastLeaseReleasedListeners.add(listener);
  return () => lastLeaseReleasedListeners.delete(listener);
}

/** Whether any live consumer currently holds a lease on this agent. */
export function hasChatInterestLease(agentId: string): boolean {
  return leaseHoldersByAgent.has(agentId);
}

/** How many distinct holders currently lease this agent. */
export function chatInterestLeaseCount(agentId: string): number {
  return leaseHoldersByAgent.get(agentId)?.size ?? 0;
}

/** Drop every lease (test reset / coordinator dispose). */
export function clearAllChatInterestLeases(): void {
  leaseHoldersByAgent.clear();
}

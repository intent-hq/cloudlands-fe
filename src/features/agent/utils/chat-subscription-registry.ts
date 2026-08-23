/**
 * Standing chat-subscription registry — which agents a standing
 * `chat.subscribe` registration (PROTOCOL §7.1) currently covers.
 *
 * The standing subscription is the SOLE canonical writer of a covered agent's
 * transcript message CONTENT. The legacy `agent:*` firehose accumulator
 * (daemon-events-bridge) consults this registry so its stream dispatches stop
 * carrying content blocks for covered agents — its terminal `complete`
 * dispatch would otherwise clobber the transcript the subscription already
 * reconciled (stale tool-block copies with no later emit to heal them), and
 * its mid-turn `content-blocks` dispatches cause visible flicker. Agents with
 * NO standing subscription (background/unviewed agents) keep the accumulator
 * as their transcript writer, so entries here are strictly per-agent.
 *
 * Written only by the chat-subscribe saga: marked when a registration
 * installs, cleared when it closes (and on coordinator dispose). Entries are
 * transient, UI-only state (per src/store AGENTS.md) — they never enter
 * Redux.
 *
 * Dependency-light per AGENTS.md utils conventions: no stores, services, or
 * wire calls — just a module-level Set with simple accessors over it.
 */

const agentsWithStandingSubscription = new Set<string>();
const agentsWithReplayableSnapshot = new Set<string>();
const agentsAcquiringSubscription = new Set<string>();

/** Whether a standing chat.subscribe registration currently covers this agent. */
export function hasStandingChatSubscription(agentId: string): boolean {
  return agentsWithStandingSubscription.has(agentId);
}

/** Record that a standing registration now covers this agent. */
export function markStandingChatSubscription(agentId: string): void {
  agentsWithStandingSubscription.add(agentId);
}

/** Record that this agent's standing registration closed. */
export function clearStandingChatSubscription(agentId: string): void {
  agentsWithStandingSubscription.delete(agentId);
  agentsWithReplayableSnapshot.delete(agentId);
}

/** Drop every entry (coordinator dispose / test reset). */
export function clearAllStandingChatSubscriptions(): void {
  agentsWithStandingSubscription.clear();
  agentsWithReplayableSnapshot.clear();
  agentsAcquiringSubscription.clear();
}

/**
 * Whether the chat-subscribe saga is actively opening a registration for this
 * agent — intent recorded (an open is enqueued/in flight) but the standing
 * registration has not installed yet. Marked when an open is enqueued, cleared
 * on install (superseded by the standing marker), on any abort/close of that
 * open, and on coordinator dispose. Consulted by the chat-read saga alongside
 * `hasStandingChatSubscription` (intent-hq/monorepo#3295): a wait window that
 * opens with NEITHER a standing registration NOR an acquisition in flight is a
 * dead wait (the seq-0 emit was dedup-consumed or the slot was already swept,
 * so no emit is coming) — the read saga escalates immediately instead of
 * stranding a full bounded wait window. A cold open whose acquisition is in
 * flight keeps the plain wait: its seq-0 emit is still coming and
 * force-cycling it would only churn a healthy opening subscription.
 */
export function hasChatSubscriptionAcquisitionInFlight(agentId: string): boolean {
  return agentsAcquiringSubscription.has(agentId);
}

/** Record that an open is enqueued/in flight for this agent (not yet standing). */
export function markChatSubscriptionAcquiring(agentId: string): void {
  agentsAcquiringSubscription.add(agentId);
}

/** Record that this agent's in-flight open installed, aborted, or closed. */
export function clearChatSubscriptionAcquiring(agentId: string): void {
  agentsAcquiringSubscription.delete(agentId);
}

/**
 * Whether the agent's standing registration can answer a snapshot re-request
 * WITHOUT a fresh wire emit — it holds a deferred pre-session snapshot or its
 * last reconciled transcript IS a snapshot. Consulted by the chat-read saga
 * at hydration start (intent-hq/monorepo#2864): true with no recorded
 * snapshot meta means the seq-0 emit was already consumed before this
 * hydration attached and no new one is coming, so the read saga escalates
 * (`chatTranscriptSnapshotRerequested`) immediately instead of stranding a
 * full bounded wait window. False on a cold open, whose seq-0 emit is still
 * in flight and settles the plain wait.
 */
export function hasReplayableChatSnapshot(agentId: string): boolean {
  return agentsWithReplayableSnapshot.has(agentId);
}

/** Record whether this agent's registration holds a replayable snapshot. */
export function setReplayableChatSnapshot(agentId: string, replayable: boolean): void {
  if (replayable) agentsWithReplayableSnapshot.add(agentId);
  else agentsWithReplayableSnapshot.delete(agentId);
}

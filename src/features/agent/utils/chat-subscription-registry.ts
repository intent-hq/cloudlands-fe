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
}

/** Drop every entry (coordinator dispose / test reset). */
export function clearAllStandingChatSubscriptions(): void {
  agentsWithStandingSubscription.clear();
}

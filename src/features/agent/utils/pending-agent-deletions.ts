/**
 * Pending agent-deletion registry — soft-hidden deletions awaiting commit.
 *
 * Agent deletion is soft-hide-then-commit (see agent-mutation-service.ts /
 * AGENTS.md): the session is hidden locally and the real `agent.delete` is
 * deferred for the undo window. During that window the daemon still returns
 * the agent from `agent.list` / `agent.get`, so every rehydration path
 * (lifecycle-read-service `hydrateWorkspaceAgents`, agent-read-service
 * `ensureAgentSession`, chat-read-service `loadChatTranscript`, and the boot
 * agents-seeder) must consult `isAgentDeletionPending()` to avoid resurrecting
 * a soft-hidden agent.
 *
 * Extracted from `agent-mutation-service.ts` (which owns the set/remove
 * lifecycle) so those dependency-light read paths can share the registry.
 * Entries are transient, UI-only state (per src/store AGENTS.md) — they never
 * enter Redux. Each entry snapshots the removed session so `undo` can restore
 * it without a wire call, and holds the timer that commits the real
 * `agent.delete` when the undo window elapses.
 *
 * Dependency-light per AGENTS.md utils conventions: no stores, services, or
 * wire calls — just a module-level Map with simple accessors and mutators
 * over it (no side effects beyond that Map and its entries' timers).
 */
import type { AgentSession } from "$shared/types";

/** A soft-hidden agent deletion awaiting commit. */
export interface PendingAgentDeletion {
  wsId: string;
  agentId: string;
  snapshot: AgentSession;
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingAgentDeletions = new Map<string, PendingAgentDeletion>();

/** Whether a soft-hidden deletion is pending for this agent. */
export function isAgentDeletionPending(agentId: string): boolean {
  return pendingAgentDeletions.has(agentId);
}

/** Read the pending entry for an agent, if any. */
export function getPendingAgentDeletion(agentId: string): PendingAgentDeletion | undefined {
  return pendingAgentDeletions.get(agentId);
}

/** Register (or replace) the pending entry for an agent. */
export function setPendingAgentDeletion(entry: PendingAgentDeletion): void {
  pendingAgentDeletions.set(entry.agentId, entry);
}

/** Drop the pending entry for an agent (undo or commit). */
export function removePendingAgentDeletion(agentId: string): void {
  pendingAgentDeletions.delete(agentId);
}

/** Snapshot of all pending entries (e.g. for a per-workspace flush). */
export function listPendingAgentDeletions(): PendingAgentDeletion[] {
  return [...pendingAgentDeletions.values()];
}

/** Test-only reset: drop all entries (clearing any armed timers first). */
export function clearPendingAgentDeletions(): void {
  for (const entry of pendingAgentDeletions.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingAgentDeletions.clear();
}

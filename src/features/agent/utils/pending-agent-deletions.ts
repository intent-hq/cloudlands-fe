/**
 * Pending agent-deletion registry — soft-hidden deletions awaiting the
 * daemon-owned commit.
 *
 * Agent deletion uses the daemon delete grace window (PROTOCOL §5.5, v6.5+):
 * the session is hidden locally and `agent.delete { undoDelayMs }` is sent
 * immediately, so the daemon owns the 15s window and commits at the deadline
 * even if the FE quits. During that window the daemon still returns the agent
 * from `agent.list` / `agent.get` (carrying `pendingDeleteAt`), so every
 * rehydration path (lifecycle read saga, agent-read-service
 * `ensureAgentSession`, and chat-read-service `loadChatTranscript`) must
 * consult `isAgentDeletionPending()` — and drop wire rows carrying
 * `pendingDeleteAt` — to avoid resurrecting a soft-hidden agent.
 *
 * Shared by the agent mutation saga and dependency-light read paths.
 * Entries are transient, UI-only state (per src/store AGENTS.md) — they never
 * enter Redux. Each entry snapshots the removed session so `undo`
 * (`agent.cancelDelete`) can restore it without a refetch. After the daemon
 * deadline the entry lingers as a tombstone for a grace window so stale
 * refetch responses cannot resurrect the deleted agent (the owning saga
 * clears it).
 *
 * Dependency-light per AGENTS.md utils conventions: no stores, services, or
 * wire calls — just a module-level Map with simple accessors and mutators
 * over it (no side effects beyond that Map).
 */
import type { AgentSession } from '$shared/types';

/** A soft-hidden agent deletion awaiting commit. */
export interface PendingAgentDeletion {
  wsId: string;
  agentId: string;
  snapshot: AgentSession;
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

/** Test-only reset: drop all entries. */
export function clearPendingAgentDeletions(): void {
  pendingAgentDeletions.clear();
}

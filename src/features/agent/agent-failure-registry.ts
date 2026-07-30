/**
 * Agent-failure registry — transient, renderer-only state.
 *
 * Collects `agent:failed` events across ALL workspaces (the daemon-events
 * bridge subscribes `agent:*` with no workspace filter), one entry per failed
 * agent, so the failure toast layer can render one toast per agent. There is
 * deliberately NO error-string grouping: a grouped "Retry All" can
 * accidentally mass-restart agents a coordinator is already recovering.
 *
 * Lifecycle (wired in `daemon-events-bridge.client.ts`):
 *   - `agent:failed`         → `recordAgentFailure` (same agentId replaces its
 *                               previous entry — an agent never double-counts)
 *   - `agent:status-changed` → `removeAgentFailure` when status leaves error
 *   - `agent:deleted`        → `removeAgentFailure`
 *
 * Like the pending-agent-deletions Map (see AGENTS.md "Transient client
 * state"), entries are transient UI-only state — never Redux, nothing
 * canonical, gone on reload. Dependency-light per AGENTS.md utils conventions:
 * no stores, services, or UI imports. The toast layer reacts through the
 * `subscribeToAgentFailures` seam rather than this module importing toast
 * code.
 */

/** One failed agent, keyed by agentId in the registry. */
export interface AgentFailureEntry {
  agentId: string;
  workspaceId: string;
  /** Raw error string from the `agent:failed` event. */
  error: string;
  /** Epoch ms when the failure was recorded. */
  at: number;
}

export type AgentFailureListener = (entries: AgentFailureEntry[]) => void;

const failuresByAgent = new Map<string, AgentFailureEntry>();
const listeners = new Set<AgentFailureListener>();

function notify(): void {
  const entries = listAgentFailureEntries();
  for (const listener of listeners) {
    try {
      listener(entries);
    } catch {
      // A throwing subscriber must not break the events bridge or the other
      // subscribers; the registry stays dependency-light (no logger import).
    }
  }
}

/**
 * Record (or replace) the failure entry for an agent. The same agent failing
 * twice keeps a single entry — the newer error/at win.
 */
export function recordAgentFailure(input: {
  agentId: string;
  workspaceId: string;
  error: string;
  at?: number;
}): AgentFailureEntry {
  const entry: AgentFailureEntry = {
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    error: input.error,
    at: input.at ?? Date.now(),
  };
  failuresByAgent.set(entry.agentId, entry);
  notify();
  return entry;
}

/**
 * Drop an agent's failure entry (recovered, retried OK, or deleted). Notifies
 * subscribers only when an entry was actually present.
 */
export function removeAgentFailure(agentId: string): boolean {
  const removed = failuresByAgent.delete(agentId);
  if (removed) notify();
  return removed;
}

/**
 * Current failure entry for an agent, if any. Entry objects are never mutated
 * in place — `recordAgentFailure` always stores a fresh object — so callers
 * can compare identity against an earlier snapshot to detect re-failures.
 */
export function getAgentFailureEntry(agentId: string): AgentFailureEntry | undefined {
  return failuresByAgent.get(agentId);
}

/** Snapshot of current failure entries, ordered oldest-first by `at`. */
export function listAgentFailureEntries(): AgentFailureEntry[] {
  return [...failuresByAgent.values()].sort((a, b) => a.at - b.at);
}

/**
 * Subscribe to registry changes. The listener receives the fresh entry
 * snapshot after every add/replace/remove. Returns an unsubscribe function.
 */
export function subscribeToAgentFailures(listener: AgentFailureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset: drop all entries and subscribers without notifying. */
export function clearAgentFailureRegistry(): void {
  failuresByAgent.clear();
  listeners.clear();
}

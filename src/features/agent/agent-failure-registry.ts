/**
 * Agent-failure aggregation registry — transient, renderer-only state.
 *
 * Collects `agent:failed` events across ALL workspaces (the daemon-events
 * bridge subscribes `agent:*` with no workspace filter) and groups them by
 * normalized error string so the aggregated-failure toast layer can render one
 * toast per error group ("N agents failed") instead of one per agent.
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
import { normalizeAgentError } from './utils/normalize-agent-error';

/** One failed agent, keyed by agentId in the registry. */
export interface AgentFailureEntry {
  agentId: string;
  workspaceId: string;
  /** Raw error string from the `agent:failed` event. */
  error: string;
  /** Normalized grouping key derived from `error`. */
  groupKey: string;
  /** Epoch ms when the failure was recorded. */
  at: number;
}

/** All failed agents sharing one normalized error. */
export interface AgentFailureGroup {
  groupKey: string;
  /** Representative raw error message (from the group's newest entry). */
  error: string;
  /** Entries ordered oldest-first by `at`. */
  entries: AgentFailureEntry[];
}

export type AgentFailureListener = (groups: AgentFailureGroup[]) => void;

const failuresByAgent = new Map<string, AgentFailureEntry>();
const listeners = new Set<AgentFailureListener>();

function notify(): void {
  const groups = listAgentFailureGroups();
  for (const listener of listeners) {
    try {
      listener(groups);
    } catch {
      // A throwing subscriber must not break the events bridge or the other
      // subscribers; the registry stays dependency-light (no logger import).
    }
  }
}

/**
 * Record (or replace) the failure entry for an agent. The same agent failing
 * twice keeps a single entry — the newer error/groupKey/at win.
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
    groupKey: normalizeAgentError(input.error),
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
 * Snapshot of current failure groups. Groups are ordered by their oldest
 * entry's `at`; entries within a group are ordered oldest-first.
 */
export function listAgentFailureGroups(): AgentFailureGroup[] {
  const byKey = new Map<string, AgentFailureEntry[]>();
  for (const entry of failuresByAgent.values()) {
    const bucket = byKey.get(entry.groupKey);
    if (bucket) bucket.push(entry);
    else byKey.set(entry.groupKey, [entry]);
  }
  const groups: AgentFailureGroup[] = [];
  for (const [groupKey, entries] of byKey) {
    entries.sort((a, b) => a.at - b.at);
    groups.push({ groupKey, error: entries[entries.length - 1].error, entries });
  }
  groups.sort((a, b) => a.entries[0].at - b.entries[0].at);
  return groups;
}

/**
 * Subscribe to registry changes. The listener receives the fresh group
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

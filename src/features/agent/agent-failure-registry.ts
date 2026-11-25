/**
 * Agent-failure registry — transient, renderer-only state.
 *
 * Collects `agent:failed` events across ALL workspaces (the daemon-events
 * bridge subscribes `agent:*` with no workspace filter), one entry per failed
 * agent.
 *
 * Lifecycle (wired in `daemon-events-bridge.client.ts`):
 *   - `agent:failed`         → `recordAgentFailure` (same agentId replaces its
 *                               previous entry — an agent never double-counts)
 *   - `agent:status-changed` → `removeAgentFailure` when status leaves error
 *   - `agent:deleted`        → `removeAgentFailure`
 *   - `agent:updated`        → `removeAgentFailureIfSwitched` when the
 *                               provider or model moved off the failed one
 *
 * Delegated agents (`parentAgentId` on `agent:failed`) are tracked in a
 * separate list that never notifies subscribers: the toast layer never shows
 * them, but a bulk provider switch moves them with their coordinator. The
 * same removal triggers apply to both lists.
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
  /** Daemon classification (`quota-exceeded`), when present. */
  errorCode?: string;
  /** Provider reference the daemon named on a quota failure. */
  eventProviderId?: string;
  /** Session provider reference and model at failure time. */
  provider?: string;
  model?: string | null;
  /** Agent name, for agents with no session in the store. */
  agentName?: string;
}

export interface DelegatedAgentFailureEntry extends AgentFailureEntry {
  parentAgentId: string;
}

type FailureInput = Omit<AgentFailureEntry, 'at'> & { at?: number };
export type AgentFailureIdentity = Pick<AgentFailureEntry, 'provider' | 'model' | 'agentName'>;

export type AgentFailureListener = (entries: AgentFailureEntry[]) => void;

const failuresByAgent = new Map<string, AgentFailureEntry>();
const delegatedByAgent = new Map<string, DelegatedAgentFailureEntry>();
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
export function recordAgentFailure(input: FailureInput): AgentFailureEntry {
  const entry = toEntry(input);
  delegatedByAgent.delete(entry.agentId);
  failuresByAgent.set(entry.agentId, entry);
  notify();
  return entry;
}

/** Record (or replace) a delegated agent's failure. Never notifies. */
export function recordDelegatedAgentFailure(
  input: FailureInput & { parentAgentId: string },
): DelegatedAgentFailureEntry {
  const entry = { ...toEntry(input), parentAgentId: input.parentAgentId };
  delegatedByAgent.set(entry.agentId, entry);
  return entry;
}

function toEntry(input: FailureInput): AgentFailureEntry {
  const entry: AgentFailureEntry = {
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    error: input.error,
    at: input.at ?? Date.now(),
  };
  if (input.errorCode) entry.errorCode = input.errorCode;
  if (input.eventProviderId) entry.eventProviderId = input.eventProviderId;
  if (input.provider) entry.provider = input.provider;
  if (input.model !== undefined) entry.model = input.model;
  if (input.agentName) entry.agentName = input.agentName;
  return entry;
}

/**
 * Fill the failure-time provider, model and name from an `agent.get` read.
 * Applies only while `snapshot` is still the stored entry (a re-failure in
 * the meantime carries its own identity). Returns whether it applied.
 */
export function updateAgentFailureIdentity(
  snapshot: AgentFailureEntry,
  identity: AgentFailureIdentity,
): boolean {
  const topLevel = failuresByAgent.get(snapshot.agentId) === snapshot;
  const delegated = delegatedByAgent.get(snapshot.agentId) === snapshot;
  if (!topLevel && !delegated) return false;
  const next = {
    ...snapshot,
    ...(identity.provider ? { provider: identity.provider } : {}),
    ...(identity.model !== undefined ? { model: identity.model } : {}),
    ...(identity.agentName ? { agentName: identity.agentName } : {}),
  };
  if (delegated) {
    delegatedByAgent.set(snapshot.agentId, next as DelegatedAgentFailureEntry);
    return true;
  }
  failuresByAgent.set(snapshot.agentId, next);
  notify();
  return true;
}

/**
 * Drop an agent's entry when its provider or model is no longer the one it
 * failed on (switched manually while still in error). An entry with no
 * recorded provider is kept: there is nothing to compare.
 */
export function removeAgentFailureIfSwitched(
  agentId: string,
  current: { provider?: string | null; model?: string | null },
): boolean {
  const entry = failuresByAgent.get(agentId) ?? delegatedByAgent.get(agentId);
  if (!entry?.provider) return false;
  const providerChanged = !!current.provider && current.provider !== entry.provider;
  const modelChanged =
    entry.model !== undefined && current.model !== undefined && current.model !== entry.model;
  if (!providerChanged && !modelChanged) return false;
  return removeAgentFailure(agentId);
}

/**
 * Drop an agent's failure entry (recovered, retried OK, or deleted). Notifies
 * subscribers only when an entry was actually present.
 */
export function removeAgentFailure(agentId: string): boolean {
  const removedDelegated = delegatedByAgent.delete(agentId);
  const removed = failuresByAgent.delete(agentId);
  if (removed) notify();
  return removed || removedDelegated;
}

/** Current delegated failure entry for an agent, if any. */
export function getDelegatedAgentFailureEntry(
  agentId: string,
): DelegatedAgentFailureEntry | undefined {
  return delegatedByAgent.get(agentId);
}

/** Tracked delegated failures, optionally only those of one coordinator. */
export function listDelegatedAgentFailures(parentAgentId?: string): DelegatedAgentFailureEntry[] {
  return [...delegatedByAgent.values()]
    .filter((entry) => parentAgentId === undefined || entry.parentAgentId === parentAgentId)
    .sort((a, b) => a.at - b.at);
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
  delegatedByAgent.clear();
  listeners.clear();
}

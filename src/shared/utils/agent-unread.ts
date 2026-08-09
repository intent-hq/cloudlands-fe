/**
 * Per-agent unread derivation (intent-hq/monorepo#1597).
 *
 * The daemon serves two AgentLite freshness fields (PROTOCOL §5.5): the id of
 * the session's newest user/assistant transcript message (`lastMessageId`,
 * additive — the same message `lastMessageRole` describes) and the persisted
 * per-conversation seen marker (`metadata.lastSeenMessageId`, advanced by
 * `agent.markSeen`). The FE derives the per-agent unread flag from their
 * comparison at wire ingest (`normalizeAgent`), so every AgentLite entity —
 * list/get reads, new-message-driven pushes, and `agent:updated` marker
 * convergence — recomputes it through one seam.
 *
 * Dependency-light per AGENTS.md: pure function, no stores or services.
 */

interface AgentUnreadInputs {
  lastMessageRole?: 'user' | 'assistant';
  lastMessageId?: string;
  metadata?: { lastSeenMessageId?: string };
}

/**
 * True when the newest transcript message is assistant-authored and the user
 * has not seen it: `lastMessageId` is present and does not match
 * `metadata.lastSeenMessageId`. An ABSENT seen marker counts as unread — the
 * user has never marked anything seen, so assistant output is new by
 * definition. Older daemons omit `lastMessageId`, which derives `false`
 * (no exact signal; consumers fall back to their heuristics).
 */
export function deriveAgentHasUnread(agent: AgentUnreadInputs): boolean {
  if (agent.lastMessageRole !== 'assistant') return false;
  const lastMessageId = normalizeId(agent.lastMessageId);
  if (lastMessageId === undefined) return false;
  return lastMessageId !== normalizeId(agent.metadata?.lastSeenMessageId);
}

/** Treats non-string / empty-string ids (daemon contract violations) as absent. */
function normalizeId(id: unknown): string | undefined {
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

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
 * Background agents (`isBackground` / `metadata.isBackground`) and delegated
 * child agents (`metadata.createdByAgentId` set) always derive `false`: the
 * unread blue dot (agent avatar + bottom-bar Agents launcher) is reserved for
 * top-level foreground agents. The child check follows the dangling-parent
 * semantics of `isTopLevelAgent` in hud-selectors — a delegated agent stays
 * suppressed even when its parent left the list — which is stricter than the
 * Agents-panel tree's nesting (that additionally requires the parent to be
 * present, so an orphaned child renders as a top-level row yet never shows
 * the dot). Unlike `isTopLevelAgent`, this derivation has no agent-id input,
 * so a (malformed) self-referencing `createdByAgentId` also suppresses the
 * dot.
 *
 * Dependency-light per AGENTS.md: pure function, no stores or services.
 */

interface AgentUnreadInputs {
  lastMessageRole?: 'user' | 'assistant';
  lastMessageId?: string;
  isBackground?: boolean;
  metadata?: {
    lastSeenMessageId?: string;
    isBackground?: unknown;
    createdByAgentId?: unknown;
  };
}

/**
 * True when the newest transcript message is assistant-authored and the user
 * has not seen it: `lastMessageId` is present and does not match
 * `metadata.lastSeenMessageId`. An ABSENT seen marker counts as unread — the
 * user has never marked anything seen, so assistant output is new by
 * definition. Older daemons omit `lastMessageId`, which derives `false`
 * (no exact signal; consumers fall back to their heuristics).
 *
 * Always `false` for background agents (`isBackground === true` or
 * `metadata.isBackground === true`) and delegated child agents
 * (`metadata.createdByAgentId` is a non-empty string) — only top-level
 * foreground agents surface the unread indicator.
 */
export function deriveAgentHasUnread(agent: AgentUnreadInputs): boolean {
  if (agent.isBackground === true || agent.metadata?.isBackground === true) return false;
  if (normalizeId(agent.metadata?.createdByAgentId) !== undefined) return false;
  if (agent.lastMessageRole !== 'assistant') return false;
  const lastMessageId = normalizeId(agent.lastMessageId);
  if (lastMessageId === undefined) return false;
  return lastMessageId !== normalizeId(agent.metadata?.lastSeenMessageId);
}

/** Treats non-string / empty-string ids (daemon contract violations) as absent. */
function normalizeId(id: unknown): string | undefined {
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

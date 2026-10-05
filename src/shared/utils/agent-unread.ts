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
 * Only rows the shared `agent-scope` classifier bins as `topLevel` can be
 * unread: background agents (`isBackground` / `metadata.isBackground`) and
 * delegated child agents (wire `parentAgentId`, or the legacy
 * `metadata.createdByAgentId`) always derive `false` — the unread blue dot
 * (agent avatar + bottom-bar Agents launcher) is reserved for top-level
 * foreground agents. The child check follows the shared classifier's
 * dangling-parent semantics (it never checks that the parent exists) — a
 * delegated agent stays suppressed even when its parent left the list —
 * which is stricter than the Agents-panel tree's nesting (that additionally
 * requires the parent to be present, so an orphaned child renders as a
 * top-level row yet never shows the dot). Unlike the HUD, this derivation
 * has no agent-id input to drop a self-reference, so a (malformed)
 * self-referencing parent id also suppresses the dot.
 *
 * Muted agents (`notificationsMuted === true`, the daemon-owned per-agent
 * mute settable via `agent.update`) also always derive `false`: the mute
 * suppresses the unread dot alongside the notification itself.
 *
 * Dependency-light per AGENTS.md: pure function, no stores or services.
 */

import { classifyAgentScope, type AgentScopeInputs, type AgentScopeMetadata } from './agent-scope';

interface AgentUnreadInputs extends AgentScopeInputs {
  lastMessageRole?: 'user' | 'assistant';
  lastMessageId?: string;
  notificationsMuted?: boolean;
  metadata?: (AgentScopeMetadata & { lastSeenMessageId?: string }) | null;
}

/**
 * True when the newest transcript message is assistant-authored and the user
 * has not seen it: `lastMessageId` is present and does not match
 * `metadata.lastSeenMessageId`. An ABSENT seen marker counts as unread — the
 * user has never marked anything seen, so assistant output is new by
 * definition. Older daemons omit `lastMessageId`, which derives `false`
 * (no exact signal; consumers fall back to their heuristics).
 *
 * Always `false` for rows outside the `topLevel` bin (background agents and
 * delegated child agents — only top-level foreground agents surface the
 * unread indicator) and for muted agents (`notificationsMuted === true`).
 */
export function deriveAgentHasUnread(agent: AgentUnreadInputs): boolean {
  if (agent.notificationsMuted === true) return false;
  if (classifyAgentScope(agent) !== 'topLevel') return false;
  if (agent.lastMessageRole !== 'assistant') return false;
  const lastMessageId = normalizeId(agent.lastMessageId);
  if (lastMessageId === undefined) return false;
  return lastMessageId !== normalizeId(agent.metadata?.lastSeenMessageId);
}

/** Treats non-string / empty-string ids (daemon contract violations) as absent. */
function normalizeId(id: unknown): string | undefined {
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

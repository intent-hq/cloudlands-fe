/**
 * Shared helpers for the global agent-cycling action keys: one parameterized
 * collect step (predicate + optional ordering + scope) over agents across
 * all workspaces, plus the next-entry step the cycle actions share. Scope
 * picks the walked list: `top-level` = foreground agents only, `all` =
 * every listed agent including delegated sub-agents (see cycle-scope.ts).
 *
 * The attention/failed predicates mirror the LED engine (led/snapshot.ts)
 * definitions so key behavior and lighting agree. Workspaces are filtered
 * through `isKeyAssignableWorkspace` (assignment/key-assignment.ts), so the
 * chief virtual workspace and archived/deleted workspaces are never cycled
 * into. Dependency-light per src/store/renderer/AGENTS.md middleware
 * conventions: no selector imports — narrow structural state only.
 */

import { AgentStatus, type Workspace } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import {
  getAgentAttentionRequest,
  getAgentStopReasonTimestamp,
} from '$shared/utils/agent-attention';
import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import { isKeyAssignableWorkspace } from '../assignment/key-assignment';
import type { CycleScope } from './cycle-scope';

/** The narrow slice of the app store state the cycle helpers read. */
export interface AgentCycleState {
  workspace: { workspaces: Collection<Workspace, 'id'> };
  workspaceAgents: {
    byWorkspaceId: Record<
      string,
      { agentIds: readonly string[]; foregroundAgentIds: readonly string[] }
    >;
  };
  agentSessions: { byAgentId: Record<string, StoredAgentSession> };
}

/**
 * One cycle stop: a workspace plus, usually, a specific agent. A `null`
 * agentId is a workspace-level stop — an unread workspace with no hydrated
 * agent sessions (unread is BE-owned on the workspace entity, so it must
 * yield a stop regardless of the local session cache,
 * intent-hq/monorepo#2438). Stepping to it navigates to the workspace
 * without focusing a specific agent.
 */
export interface CycleStopEntry {
  wsId: string;
  agentId: string | null;
}

/** One cyclable agent: its workspace plus its id. */
export interface CycleAgentEntry extends CycleStopEntry {
  agentId: string;
}

/** Key prefix marking a workspace-level stop in `cycleStopKey` values. */
export const WORKSPACE_STOP_KEY_PREFIX = 'workspace:';

/**
 * Stable cursor/dedup key for a stop. Agent stops key by agent id;
 * workspace-level stops key by a `workspace:`-prefixed workspace id, which
 * cannot collide with an agent id.
 */
export function cycleStopKey(entry: CycleStopEntry): string {
  return entry.agentId ?? `${WORKSPACE_STOP_KEY_PREFIX}${entry.wsId}`;
}

/** Local mirror of the "agent turn active" gate (no selector imports). */
export function isSessionInProgress(session: StoredAgentSession | undefined): boolean {
  if (!session) return false;
  const status = session.status as AgentStatus;
  if (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted
  ) {
    return false;
  }
  return (
    session.isProcessing === true ||
    session.isStreaming === true ||
    session.isResponding === true ||
    status === AgentStatus.Active ||
    status === AgentStatus.Processing
  );
}

/**
 * Mirror of the LED engine's `isAgentTurnActive` gate (led/snapshot.ts) —
 * broader than `isSessionInProgress` (adds tool waits, activation, Waiting).
 * Gates the pending-question derivation and the idle definition.
 */
function isAgentTurnActive(session: StoredAgentSession): boolean {
  const status = session.status as AgentStatus;
  if (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted
  ) {
    return false;
  }
  return (
    session.isProcessing === true ||
    session.isStreaming === true ||
    session.isResponding === true ||
    session.isWaitingOnTool === true ||
    session.activationState === AgentActivationState.ACTIVATING ||
    status === AgentStatus.Active ||
    status === AgentStatus.Processing ||
    status === AgentStatus.Waiting
  );
}

/** Whether a session has a pending Q&A wizard question (dismissal-gated). */
function hasPendingQuestion(session: StoredAgentSession): boolean {
  const pending = derivePendingQuestions(session.messages ?? [], isAgentTurnActive(session));
  if (!pending) return false;
  const dismissedId = session.metadata?.dismissedQuestionsMessageId;
  return !(typeof dismissedId === 'string' && dismissedId === pending.messageId);
}

/** Attention priority buckets, highest urgency first. */
export type SessionAttentionPriority = 'blocker' | 'question' | 'discussion';

/**
 * Classify a session's attention priority: a pending blocker report beats a
 * pending wizard question beats a pending discussion request; `null` when
 * the session needs no attention. Consistent with `sessionNeedsAttention` —
 * a session needs attention iff its priority is non-null.
 */
export function sessionAttentionPriority(
  session: StoredAgentSession | undefined,
): SessionAttentionPriority | null {
  if (!session || session.status === AgentStatus.Deleted) return null;
  const kind = getAgentAttentionRequest(session)?.kind ?? null;
  if (kind === 'blocker') return 'blocker';
  if (hasPendingQuestion(session)) return 'question';
  return kind === 'discussion' ? 'discussion' : null;
}

/**
 * Attention = pending attention request (discussion/blocker) or pending
 * wizard question — the LED engine's attention definition (led/snapshot.ts).
 */
export function sessionNeedsAttention(session: StoredAgentSession | undefined): boolean {
  return sessionAttentionPriority(session) !== null;
}

/** Failed = error status — the LED engine's failed definition. */
export function sessionHasFailed(session: StoredAgentSession | undefined): boolean {
  return session?.status === AgentStatus.Error;
}

/** All-agents family: every listed top-level agent that is not deleted. */
export function isSessionCyclable(session: StoredAgentSession | undefined): boolean {
  return session !== undefined && session.status !== AgentStatus.Deleted;
}

/** Idle = not deleted, not failed, not needing attention, turn not active. */
export function isSessionIdle(session: StoredAgentSession | undefined): boolean {
  if (!session || session.status === AgentStatus.Deleted) return false;
  return (
    !sessionHasFailed(session) && !sessionNeedsAttention(session) && !isAgentTurnActive(session)
  );
}

function parseTime(value: Date | string | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * When the agent last went idle: the daemon's latest terminal-stop timestamp
 * (`stopReasonTimestamp`, PROTOCOL §5.5), falling back to `lastActivity`.
 * 0 when unknown.
 */
export function getLastIdleTime(session: StoredAgentSession | undefined): number {
  if (!session) return 0;
  const stop = getAgentStopReasonTimestamp(session);
  if (stop !== null) return parseTime(stop);
  return parseTime(session.lastActivity);
}

/** Most-recently-idle first (recency-descending, matching app conventions). */
export function compareLastIdleDesc(a: StoredAgentSession, b: StoredAgentSession): number {
  return getLastIdleTime(b) - getLastIdleTime(a);
}

/**
 * Reduce a walk to one entry per workspace: the entry whose session was most
 * recently active (`getLastIdleTime`). Ties — including the no-recency-signal
 * case where every time is 0 — keep the earliest entry, so the deterministic
 * fallback is that workspace's first entry in walk order (the first
 * foreground agent for a top-level walk). Workspaces keep the order of their
 * first occurrence in `entries`.
 */
export function pickLastActivePerWorkspace(
  state: Pick<AgentCycleState, 'agentSessions'>,
  entries: readonly CycleAgentEntry[],
): CycleAgentEntry[] {
  const bestByWsId = new Map<string, { entry: CycleAgentEntry; time: number }>();
  for (const entry of entries) {
    const time = getLastIdleTime(state.agentSessions.byAgentId[entry.agentId]);
    const best = bestByWsId.get(entry.wsId);
    if (!best || time > best.time) bestByWsId.set(entry.wsId, { entry, time });
  }
  return [...bestByWsId.values()].map((item) => item.entry);
}

/**
 * Collect matching agents across all key-assignable workspaces (the chief
 * virtual workspace and archived/deleted workspaces are skipped), in
 * workspace order. Scope picks the walked list per workspace: `top-level`
 * (default) walks the foreground agents; `all` walks every listed agent
 * (sub-agents included). An optional comparator re-orders the result
 * (stable sort, ties keep workspace order).
 */
export function collectCycleAgents(
  state: AgentCycleState,
  predicate: (session: StoredAgentSession, agentId: string) => boolean,
  compare?: (a: StoredAgentSession, b: StoredAgentSession) => number,
  scope: CycleScope = 'top-level',
): CycleAgentEntry[] {
  const entries: { entry: CycleAgentEntry; session: StoredAgentSession }[] = [];
  for (const workspace of getItems(state.workspace.workspaces)) {
    if (!isKeyAssignableWorkspace(workspace)) continue;
    const workspaceState = state.workspaceAgents.byWorkspaceId[workspace.id];
    const ids =
      (scope === 'all' ? workspaceState?.agentIds : workspaceState?.foregroundAgentIds) ?? [];
    for (const rawId of ids) {
      const agentId = String(rawId);
      const session = state.agentSessions.byAgentId[agentId];
      if (session && predicate(session, agentId)) {
        entries.push({ entry: { wsId: workspace.id, agentId }, session });
      }
    }
  }
  if (compare) entries.sort((a, b) => compare(a.session, b.session));
  return entries.map((item) => item.entry);
}

/**
 * One stop per unread key-assignable workspace, in workspace order (unread
 * is workspace-level, BE-owned `workspace.attention`). When the workspace
 * has hydrated cyclable top-level sessions, the stop is its last active
 * agent (`getLastIdleTime` recency, falling back to the first foreground
 * agent — intent-hq/monorepo#1779). When none are hydrated yet (sessions
 * hydrate lazily), the stop is workspace-level (`agentId: null`) so the
 * walk never misses an unread workspace (intent-hq/monorepo#2438).
 */
export function collectUnreadWorkspaceStops(state: AgentCycleState): CycleStopEntry[] {
  const unreadWorkspaceIds: string[] = getItems(state.workspace.workspaces)
    .filter((workspace) => workspace.attention === 'unread' && isKeyAssignableWorkspace(workspace))
    .map((workspace) => workspace.id);
  const unreadIdSet = new Set(unreadWorkspaceIds);
  const hydratedByWsId = new Map(
    pickLastActivePerWorkspace(
      state,
      collectCycleAgents(state, isSessionCyclable).filter((entry) => unreadIdSet.has(entry.wsId)),
    ).map((entry) => [entry.wsId, entry] as const),
  );
  return unreadWorkspaceIds.map(
    (wsId) => hydratedByWsId.get(wsId) ?? ({ wsId, agentId: null } satisfies CycleStopEntry),
  );
}

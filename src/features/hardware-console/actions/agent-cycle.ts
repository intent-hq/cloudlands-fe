/**
 * Shared helpers for the global agent-cycling action keys: one parameterized
 * collect step (predicate + optional ordering + scope) over agents across
 * all workspaces, plus the next-entry step the cycle actions share. Scope
 * picks the walked list: `top-level` = foreground agents only, `all` =
 * every listed agent including delegated sub-agents (see cycle-scope.ts).
 *
 * The attention/failed predicates mirror the LED engine (led/snapshot.ts)
 * definitions so key behavior and lighting agree. Dependency-light per
 * src/store/renderer/AGENTS.md middleware conventions: no selector imports —
 * narrow structural state only.
 */

import { AgentStatus, type Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { AgentActivationState } from '$shared/types/agent-session';
import {
  getAgentAttentionRequest,
  getAgentStopReasonTimestamp,
} from '$shared/utils/agent-attention';
import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
import { getItems, type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
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

/** One cyclable agent: its workspace plus its id. */
export interface CycleAgentEntry {
  wsId: string;
  agentId: string;
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

/**
 * Attention = pending attention request (discussion/blocker) or pending
 * wizard question — the LED engine's attention definition (led/snapshot.ts).
 */
export function sessionNeedsAttention(session: StoredAgentSession | undefined): boolean {
  if (!session || session.status === AgentStatus.Deleted) return false;
  return getAgentAttentionRequest(session) !== null || hasPendingQuestion(session);
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
 * Collect matching agents across all workspaces, in workspace order. Scope
 * picks the walked list per workspace: `top-level` (default) walks the
 * foreground agents; `all` walks every listed agent (sub-agents included).
 * An optional comparator re-orders the result (stable sort, ties keep
 * workspace order).
 */
export function collectCycleAgents(
  state: AgentCycleState,
  predicate: (session: StoredAgentSession, agentId: string) => boolean,
  compare?: (a: StoredAgentSession, b: StoredAgentSession) => number,
  scope: CycleScope = 'top-level',
): CycleAgentEntry[] {
  const entries: { entry: CycleAgentEntry; session: StoredAgentSession }[] = [];
  for (const workspace of getItems(state.workspace.workspaces)) {
    if (workspace.id === CHIEF_WORKSPACE_ID) continue;
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

import type { AgentSession, Workspace } from '$shared/types';
import { workspaceReminderStatus } from '$shared/utils/workspace-attention-reminder';
import { getHomeAttentionRequests } from './home-attention';
import {
  HOME_SET_ASIDE_KNOWN_CAPACITY,
  type HomeSetAsideRecord,
} from './home-workspaces-persistence';

/** Display statuses that ask the user to act. PR readiness and completion are not requests. */
const RETURNING_STATUSES = new Set(['failed', 'blocked', 'needs_attention']);

export interface HomeAttentionToken {
  token: string;
  agentId?: string;
  timestamp?: number;
}

/** Stable identities for each pending, actionable request on a workspace. */
export function homeSetAsideAttention(
  workspace: Workspace,
  agents: readonly AgentSession[],
): HomeAttentionToken[] {
  const tokens: HomeAttentionToken[] = [];
  const reminder = workspace.attentionReminder;
  const status = workspaceReminderStatus(workspace);
  // Each signal is independent, so a review request on an already blocked workspace is new.
  if (status && RETURNING_STATUSES.has(status)) tokens.push({ token: `workspace:${status}` });
  if (workspace.attention === 'review_required' && !reminder?.dismissed)
    tokens.push({ token: 'workspace:review' });
  if (reminder && !reminder.dismissed)
    for (const { id, revision } of reminder.reasons)
      tokens.push({ token: `reminder:${JSON.stringify([id, revision])}` });
  // Only workspace causes are known to be loaded. Late session hydration keeps
  // its own observed-agent and timestamp baseline below.
  if (!reminder && tokens.length) tokens.push({ token: 'workspace:reminder-unavailable' });
  for (const request of getHomeAttentionRequests(workspace.id, [...agents])) {
    const parsed = request.timestamp ? Date.parse(request.timestamp) : NaN;
    tokens.push({
      token: `agent:${request.agentId}:${request.kind}:${request.questionMessageId ?? ''}:${request.timestamp ?? ''}`,
      agentId: request.agentId,
      timestamp: Number.isFinite(parsed) ? parsed : undefined,
    });
  }
  return tokens;
}

export type HomeSetAsideDecision =
  { kind: 'unchanged' } | { kind: 'record'; known: string[]; knownAt: number } | { kind: 'return' };

/**
 * Decide whether set-aside work should come back. Attention the user already
 * knew about stays settled; a new request (or a request that cleared and
 * returned) brings it back. Agent requests from sessions that were not loaded
 * yet are judged by time so a late session load does not look new.
 */
export function decideHomeSetAside(
  record: HomeSetAsideRecord,
  current: readonly HomeAttentionToken[],
  observedAgentIds: ReadonlySet<string>,
  now: number,
): HomeSetAsideDecision {
  const tokens = [...new Set(current.map((entry) => entry.token))];
  if (record.known === null) return { kind: 'record', known: bounded(tokens), knownAt: now };
  if (tokens.length === 0)
    return record.known.length === 0
      ? { kind: 'unchanged' }
      : { kind: 'record', known: [], knownAt: now };
  const known = new Set(record.known);
  const absorbed: string[] = [];
  for (const entry of current) {
    if (known.has(entry.token) || absorbed.includes(entry.token)) continue;
    if (!entry.agentId) return { kind: 'return' };
    // An agent in the durable baseline was seen before, even across a restart.
    const seenBefore =
      observedAgentIds.has(entry.agentId) ||
      record.known.some((token) => token.startsWith(`agent:${entry.agentId}:`));
    if (seenBefore || (entry.timestamp !== undefined && entry.timestamp > record.knownAt))
      return { kind: 'return' };
    absorbed.push(entry.token);
  }
  // Workspace-level causes are always loaded, so a vanished one has resolved.
  // Agent requests may only be unloaded, so they stay known until all attention clears.
  const live = new Set(tokens);
  const next = bounded([
    ...record.known.filter((token) => live.has(token) || token.startsWith('agent:')),
    ...absorbed,
  ]);
  const previous = record.known;
  const same = next.length === previous.length && next.every((t, i) => t === previous[i]);
  return same ? { kind: 'unchanged' } : { kind: 'record', known: next, knownAt: record.knownAt };
}

function bounded(tokens: string[]): string[] {
  return tokens.slice(-HOME_SET_ASIDE_KNOWN_CAPACITY);
}

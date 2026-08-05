/**
 * HUD takeover triggers — the single const mapping daemon events (PROTOCOL
 * §6.1/§6.3) to takeover kinds, plus the pure event → trigger mapper.
 *
 * Notable events that open a takeover (task spec): task → complete, agent
 * delegated (created) / started, agent failed, question asked (attention
 * raised OR the turn-terminal `agent:stream:end` carrying §7.1 question
 * trailingBlocks — the only place the question TEXT travels live), workspace
 * STATUS MESSAGE text changes (`workspace:updated` whose §6.5 `changes`
 * delta carries a non-empty `statusMessage`), and workspace displayStatus
 * transitions (`workspace:displayStatus-changed`, §6.5) landing on the
 * ALLOWLIST — idle / pr_open / pr_ready / pr_merged / complete; every other
 * displayStatus value (in_progress, needs_attention, not_started, unknown)
 * keeps updating cards and counters live via the feed families without
 * taking over, and per-agent idle events (`agent:idle`, idle-bucket
 * `agent:status-changed`) remain non-triggers. All other events return null.
 * `detail` is composed from wire identifiers (task titles, agent names,
 * question text) — wire content, i18n-exempt; the overlay localizes labels
 * off `kind`. Agent names never render as raw `agent-{uuid}` ids: the
 * caller-supplied resolver (store-backed) is consulted and an unresolvable
 * name is OMITTED from the detail rather than falling back to the id.
 */
import type { WorkspaceEvent } from '$features/events/types';
import { isHudAttentionValue } from '$store/renderer/slices/hud/hud-types';
import { extractQuestionsFromStreamEnd } from '../hud-question-capture';
import type { HudTakeoverKind, HudTakeoverTrigger } from './hud-takeover-queue';

/**
 * Wire event type → takeover kind. THE single trigger set: the subscription
 * and any future surface must derive from this const, never re-list types.
 * `workspace:displayStatus-changed` maps to MULTIPLE kinds (one per allowed
 * displayStatus value — see `DISPLAY_STATUS_TAKEOVER_KINDS`); its entry here
 * is a representative and the per-family gate resolves the real kind.
 */
export const HUD_TAKEOVER_TRIGGER_KINDS: Readonly<Record<string, HudTakeoverKind>> = {
  'task:status-changed': 'task_complete',
  'agent:created': 'agent_delegated',
  'agent:started': 'agent_started',
  'agent:failed': 'agent_failed',
  'workspace:attention-changed': 'question_asked',
  'agent:stream:end': 'question_asked',
  'agent:attention-requested': 'question_asked',
  'workspace:updated': 'status_update',
  'workspace:displayStatus-changed': 'workspace_idle',
};

/**
 * ALLOWLIST gate for `workspace:displayStatus-changed` (§5.1 wire values →
 * takeover kinds). Every other displayStatus value (in_progress,
 * needs_attention, not_started, unknown) never takes over.
 */
export const DISPLAY_STATUS_TAKEOVER_KINDS: Readonly<Record<string, HudTakeoverKind>> = {
  idle: 'workspace_idle',
  pr_open: 'pr_open',
  pr_ready: 'pr_ready',
  pr_merged: 'pr_merged',
  complete: 'workspace_complete',
};

/** Event types that can open a takeover (keys of the trigger-kind const). */
export const HUD_TAKEOVER_EVENT_TYPES = Object.keys(HUD_TAKEOVER_TRIGGER_KINDS);

/** Store-backed agent-id → display-name lookup (see `friendly-labels.ts`). */
export type HudAgentNameResolver = (agentId: string) => string | undefined;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Whether a name is actually a raw agent id (never render those). */
function looksLikeAgentId(name: string): boolean {
  return /^agent-[a-f0-9-]{36}$/i.test(name);
}

/**
 * Best display name for the event's agent: the payload's name field
 * (`agentName`, or `name` — `agent:created` emits `{ agentId, name }`), else
 * the resolver, dropping UUID-shaped values. Undefined when unresolvable —
 * the caller omits the name instead of showing a raw id.
 */
function agentDisplayName(
  data: Record<string, unknown>,
  resolveAgentName?: HudAgentNameResolver,
): string | undefined {
  const wireName = str(data.agentName) ?? str(data.name);
  if (wireName && !looksLikeAgentId(wireName)) return wireName;
  const agentId = str(data.agentId);
  const resolved = agentId && resolveAgentName ? resolveAgentName(agentId) : undefined;
  return resolved && !looksLikeAgentId(resolved) ? resolved : undefined;
}

/**
 * Map one daemon event to a takeover trigger, or null when the event is not
 * a takeover family or fails its per-family gate:
 *  - `task:status-changed` only fires on `newStatus === "complete"`;
 *  - `workspace:attention-changed` only fires when raising a HUD attention
 *    value (`isHudAttentionValue` allowlist — "none" and non-attention values
 *    like "unread", the main app's blue dot, never take over);
 *  - `agent:stream:end` only fires when its trailingBlocks carry a §7.1
 *    question resource block, extracted through the SAME
 *    `extractQuestionsFromStreamEnd` the footer/panel question capture uses
 *    (one shared source — the banner sub-title, footer snippet, and panel
 *    row can never show different text); the trigger carries the question
 *    text plus the raising agent's display name and the `question` signal;
 *  - `agent:attention-requested` (§6.5 — `requestDiscussion`/`reportBlocker`)
 *    fires with the reason text, the agent's name, and the blocker/discussion
 *    signal; delegated agents (non-empty `parentAgentId`) never take over —
 *    the parent handles the request (same gate as the attention toast);
 *  - `workspace:updated` only fires when its `changes` delta carries a
 *    non-empty `statusMessage` (cleared/empty messages and other field
 *    updates never take over); the caller dedupes same-text repeats;
 *  - `workspace:displayStatus-changed` only fires on the
 *    `DISPLAY_STATUS_TAKEOVER_KINDS` allowlist (idle / pr_open / pr_ready /
 *    pr_merged / complete), resolving the kind from the displayStatus value;
 *    the raw wire word never travels as `detail` — the banner renders the
 *    workspace title with the localized kind chip;
 *  - `agent:failed` / `agent:created` / `agent:started` always fire.
 */
export function mapEventToTakeoverTrigger(
  event: WorkspaceEvent,
  resolveAgentName?: HudAgentNameResolver,
): HudTakeoverTrigger | null {
  const type: string = typeof event.type === 'string' ? event.type : '';
  let kind = HUD_TAKEOVER_TRIGGER_KINDS[type];
  if (!kind) return null;
  const workspaceId = str(event.workspaceId);
  if (!workspaceId) return null;
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};

  let detail = '';
  let changedTaskId: string | null = null;
  let agentName: string | null = null;
  let signal: HudTakeoverTrigger['signal'] = null;
  switch (type) {
    case 'task:status-changed': {
      if (str(data.newStatus) !== 'complete') return null;
      detail = str(data.noteTitle) ?? str(data.noteId) ?? '';
      changedTaskId = str(data.noteId) ?? null;
      break;
    }
    case 'agent:created':
    case 'agent:started':
      detail = agentDisplayName(data, resolveAgentName) ?? '';
      break;
    case 'agent:failed':
      detail = [agentDisplayName(data, resolveAgentName), str(data.error)]
        .filter(Boolean)
        .join(': ');
      break;
    case 'workspace:attention-changed': {
      const attention = str(data.attention);
      if (!attention || !isHudAttentionValue(attention)) return null;
      detail = attention;
      break;
    }
    case 'agent:stream:end': {
      const question = extractQuestionsFromStreamEnd(event)[0];
      if (!question) return null;
      detail = question.question;
      agentName = agentDisplayName(data, resolveAgentName) ?? null;
      signal = 'question';
      break;
    }
    case 'agent:attention-requested': {
      const parentAgentId = str(data.parentAgentId);
      if (parentAgentId) return null;
      const kindValue = str(data.kind);
      const reason = str(data.reason);
      if ((kindValue !== 'discussion' && kindValue !== 'blocker') || !reason) return null;
      detail = reason;
      agentName = agentDisplayName(data, resolveAgentName) ?? null;
      signal = kindValue;
      break;
    }
    case 'workspace:updated': {
      const changes =
        data.changes && typeof data.changes === 'object'
          ? (data.changes as Record<string, unknown>)
          : {};
      const statusMessage = str(changes.statusMessage);
      if (!statusMessage) return null;
      detail = statusMessage;
      break;
    }
    case 'workspace:displayStatus-changed': {
      const resolved = DISPLAY_STATUS_TAKEOVER_KINDS[str(data.displayStatus) ?? ''];
      if (!resolved) return null;
      kind = resolved;
      break;
    }
  }

  const raisedAtMs =
    typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
  return {
    workspaceId,
    kind,
    detail,
    raisedAtMs: Number.isFinite(raisedAtMs) ? raisedAtMs : Date.now(),
    changedTaskId,
    agentName,
    signal,
  };
}

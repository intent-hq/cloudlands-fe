/**
 * HUD takeover triggers — the single const mapping daemon events (PROTOCOL
 * §6.1/§6.3) to takeover kinds, plus the pure event → trigger mapper.
 *
 * Notable events that open a takeover (task spec): task → complete, agent
 * delegated (created) / started, agent failed, question asked (attention
 * raised OR the turn-terminal `agent:stream:end` carrying §7.1 question
 * trailingBlocks — the only place the question TEXT travels live), and
 * workspace STATUS MESSAGE text changes (`workspace:updated` whose §6.5
 * `changes` delta carries a non-empty `statusMessage`). displayStatus
 * transitions deliberately do NOT take over — they keep updating cards and
 * counters live via the feed families. All other events return null.
 * `detail` is composed from wire identifiers (task titles, agent names,
 * question text) — wire content, i18n-exempt; the overlay localizes labels
 * off `kind`. Agent names never render as raw `agent-{uuid}` ids: the
 * caller-supplied resolver (store-backed) is consulted and an unresolvable
 * name is OMITTED from the detail rather than falling back to the id.
 */
import type { WorkspaceEvent } from '$features/events/types';
import { getQuestionFromResourceBlock } from '$shared/types/question-resource';
import type { HudTakeoverKind, HudTakeoverTrigger } from './hud-takeover-queue';

/**
 * Wire event type → takeover kind. THE single trigger set: the subscription
 * and any future surface must derive from this const, never re-list types.
 */
export const HUD_TAKEOVER_TRIGGER_KINDS: Readonly<Record<string, HudTakeoverKind>> = {
  'task:status-changed': 'task_complete',
  'agent:created': 'agent_delegated',
  'agent:started': 'agent_started',
  'agent:failed': 'agent_failed',
  'workspace:attention-changed': 'question_asked',
  'agent:stream:end': 'question_asked',
  'workspace:updated': 'status_update',
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

/** First §7.1 question payload in the terminal event's trailingBlocks. */
function firstTrailingQuestion(data: Record<string, unknown>) {
  if (!Array.isArray(data.trailingBlocks)) return null;
  for (const block of data.trailingBlocks) {
    const question = getQuestionFromResourceBlock(block);
    if (question) return question;
  }
  return null;
}

/**
 * Map one daemon event to a takeover trigger, or null when the event is not
 * a takeover family or fails its per-family gate:
 *  - `task:status-changed` only fires on `newStatus === "complete"`;
 *  - `workspace:attention-changed` only fires while raising (not "none");
 *  - `agent:stream:end` only fires when its trailingBlocks carry a §7.1
 *    question resource block (the trigger surfaces the question text);
 *  - `workspace:updated` only fires when its `changes` delta carries a
 *    non-empty `statusMessage` (cleared/empty messages and other field
 *    updates never take over); the caller dedupes same-text repeats;
 *  - `agent:failed` / `agent:created` / `agent:started` always fire.
 */
export function mapEventToTakeoverTrigger(
  event: WorkspaceEvent,
  resolveAgentName?: HudAgentNameResolver,
): HudTakeoverTrigger | null {
  const type: string = typeof event.type === 'string' ? event.type : '';
  const kind = HUD_TAKEOVER_TRIGGER_KINDS[type];
  if (!kind) return null;
  const workspaceId = str(event.workspaceId);
  if (!workspaceId) return null;
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};

  let detail = '';
  let changedTaskId: string | null = null;
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
      if (!attention || attention === 'none') return null;
      detail = attention;
      break;
    }
    case 'agent:stream:end': {
      const question = firstTrailingQuestion(data);
      if (!question) return null;
      detail = question.question;
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
  }

  const raisedAtMs =
    typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
  return {
    workspaceId,
    kind,
    detail,
    raisedAtMs: Number.isFinite(raisedAtMs) ? raisedAtMs : Date.now(),
    changedTaskId,
  };
}

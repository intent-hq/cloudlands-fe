/**
 * HUD feed mapper — daemon `events.event` payload (PROTOCOL §6.3) → feed row.
 *
 * Pure function so the mapping is unit-testable against PROTOCOL-shaped
 * payloads. Returns null for event types the feed does not render. `text` is
 * composed from wire identifiers (agent names, statuses, task titles) — wire
 * content, i18n-exempt; the UI renders localized labels off `kind`.
 */
import type { WorkspaceEvent } from '$features/events/types';
import type {
  HudFeedColorClass,
  HudFeedEntry,
} from '$store/renderer/slices/hud/hud-slice';
import {
  HUD_UNREAD_ATTENTION_VALUE,
  isHudAttentionValue,
  toHudAgentStateBucket,
} from '$store/renderer/slices/hud/hud-types';

/**
 * Event types the HUD feed renders (PROTOCOL §6.1 exact + wildcard mix).
 * `agent:deleted` and `agent:created` are deliberately absent: deletions
 * never render a feed row, and raw creations don't either — the AGENT
 * DELEGATED row is emitted by the subscription on the agent's FIRST running
 * transition instead (see `HUD_AGENT_DELEGATED_FEED_KIND`). Roster folding
 * for both is the daemon-events-bridge's, off its own lifecycle
 * subscription, not this feed subscription.
 */
export const HUD_FEED_EVENT_TYPES = [
  'agent:started',
  'agent:completed',
  'agent:failed',
  'agent:idle',
  'agent:status-changed',
  'task:status-changed',
  'workspace:displayStatus-changed',
  'workspace:attention-changed',
  'pr:linked',
  'pr:updated',
  'pr:unlinked',
  'git:commit',
  'git:pull',
] as const;

/**
 * Synthetic feed kind (not a wire event type): the one AGENT DELEGATED row a
 * new agent gets when it FIRST starts work. The subscription rewrites the
 * first running `agent:status-changed` row per agent id to this kind — the
 * raw `agent:created` moment never renders, and later running transitions
 * keep their normal AGENT RUNNING chip.
 */
export const HUD_AGENT_DELEGATED_FEED_KIND = 'agent:delegated';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Row color class per the canonical HUD state→color table (`HUD_STATE_COLORS`
 * in hud-card-meta): lifecycle rows color by the state they ANNOUNCE —
 * STARTED/RUNNING green (`info`), WAITING/IDLE grey (`idle`), DONE stable
 * green (`ok`), FAILED red (`err`), attention rows yellow (`warn`), PR
 * family blue (`accent`).
 */
function colorFor(type: string, data: Record<string, unknown>): HudFeedColorClass {
  if (type === 'agent:failed') return 'err';
  if (type === 'agent:status-changed') {
    const status = str(data.status) ?? '';
    if (status === 'error' || status === 'failed') return 'err';
    if (status === 'completed') return 'ok';
    if (toHudAgentStateBucket(status) === 'running') return 'info';
    // Waiting/pending and idle transitions are not running work — grey.
    return 'idle';
  }
  if (type === 'agent:idle') return 'idle';
  if (type === 'agent:completed') return 'ok';
  if (type === 'task:status-changed') {
    return str(data.newStatus) === 'complete' ? 'ok' : 'info';
  }
  if (type === 'workspace:displayStatus-changed') {
    const status = str(data.displayStatus);
    if (status === 'pr_merged' || status === 'complete') return 'ok';
    if (status === 'pr_ready' || status === 'pr_open') return 'accent';
    if (status === 'needs_attention') return 'warn';
    if (status === 'idle' || status === 'not_started') return 'idle';
    return 'info';
  }
  if (type === 'workspace:attention-changed') {
    // Only real HUD attention values warn; "none" is informational (`unread`
    // deliveries are suppressed entirely — see `isUnreadAttentionChange`).
    return isHudAttentionValue(str(data.attention) ?? '') ? 'warn' : 'info';
  }
  if (type.startsWith('pr:')) return 'accent';
  return 'info';
}

/**
 * Wire-derived detail text per event family. Agent identity is deliberately
 * NOT part of the text: raw agent UUIDs must never render, so agent rows
 * carry `agentId`/`agentName` separately and the selector joins the display
 * name (omitting it when unresolvable).
 */
function textFor(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'agent:started':
    case 'agent:completed':
    case 'agent:idle':
      return '';
    case 'agent:failed':
      return str(data.error) ?? '';
    case 'agent:status-changed':
      // The chip names the state (AGENT RUNNING / IDLE / FAILED …) off the
      // out-of-band `agentStatus`, so the raw status word is redundant here.
      return '';
    case 'task:status-changed':
      return [str(data.noteTitle) ?? str(data.noteId), str(data.newStatus)]
        .filter(Boolean)
        .join(' → ');
    case 'workspace:displayStatus-changed':
      // The raw wire value (in_progress, needs_attention, …) never renders:
      // the row carries `displayStatus` out-of-band and the panel renders
      // the localized card-state label (same source as the card banner).
      return '';
    case 'workspace:attention-changed':
      return str(data.attention) ?? '';
    case 'pr:linked':
    case 'pr:updated': {
      const pr = typeof data.prNumber === 'number' ? `#${data.prNumber}` : undefined;
      return [pr, str(data.prStatus)].filter(Boolean).join(' ');
    }
    case 'pr:unlinked':
      return '';
    case 'git:commit':
      return str(data.message) ?? str(data.commit) ?? '';
    case 'git:pull':
      return str(data.branch) ?? '';
    default:
      return '';
  }
}

/**
 * A went-idle `agent:status-changed` duplicates the canonical `agent:idle`
 * event the daemon emits at the same instant (§6.5) — both would render an
 * AGENT IDLE chip, in different colors. Suppress the status-changed twin;
 * the specific chips (RUNNING / WAITING / DONE / FAILED) still render.
 * Explicit idle allowlist — NOT `toHudAgentStateBucket`'s default fallback,
 * which would also swallow unknown future statuses the daemon intentionally
 * emits a status-changed for.
 */
const IDLE_WIRE_STATUSES = new Set(['idle', 'inactive']);

function isIdleStatusChange(type: string, data: Record<string, unknown>): boolean {
  if (type !== 'agent:status-changed') return false;
  const status = (str(data.status) ?? '').toLowerCase();
  return IDLE_WIRE_STATUSES.has(status);
}

/**
 * An `unread` `workspace:attention-changed` duplicates the `agent:idle` the
 * daemon emits at the same turn end (§9.9 raises the blue dot on EVERY turn
 * end) — the card/counters render the UNREAD state live off the hud slice,
 * so the feed row would only double-post. Suppress it; urgent raises
 * (`review_required`) and `none` clears still render.
 */
function isUnreadAttentionChange(type: string, data: Record<string, unknown>): boolean {
  return (
    type === 'workspace:attention-changed' && str(data.attention) === HUD_UNREAD_ATTENTION_VALUE
  );
}

/**
 * Map one daemon event to a feed entry, or null when the type is not a feed
 * family or the envelope is missing its identity fields.
 */
export function mapEventToFeedEntry(event: WorkspaceEvent): HudFeedEntry | null {
  // Widened to string: the feed handles wire event types beyond the
  // WorkspaceEventType union (§6.5 families the bridge does not fold).
  const type: string = typeof event.type === 'string' ? event.type : '';
  if (!(HUD_FEED_EVENT_TYPES as readonly string[]).includes(type)) return null;
  const id = str(event.id);
  const ts = str(event.timestamp);
  const workspaceId = str(event.workspaceId);
  if (!id || !ts || !workspaceId) return null;
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  if (isIdleStatusChange(type, data)) return null;
  if (isUnreadAttentionChange(type, data)) return null;
  const entry: HudFeedEntry = {
    id,
    ts,
    colorClass: colorFor(type, data),
    source: workspaceId,
    kind: type,
    text: textFor(type, data),
  };
  if (type.startsWith('agent:')) {
    const agentId = str(data.agentId);
    const agentName = str(data.agentName);
    if (agentId) entry.agentId = agentId;
    if (agentName) entry.agentName = agentName;
    if (type === 'agent:status-changed') {
      const agentStatus = str(data.status);
      if (agentStatus) entry.agentStatus = agentStatus;
    }
  }
  if (type === 'workspace:displayStatus-changed') {
    const displayStatus = str(data.displayStatus);
    if (displayStatus) entry.displayStatus = displayStatus;
  }
  return entry;
}

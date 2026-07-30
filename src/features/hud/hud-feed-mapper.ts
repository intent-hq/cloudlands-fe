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

/** Event types the HUD subscribes to (PROTOCOL §6.1 exact + wildcard mix). */
export const HUD_FEED_EVENT_TYPES = [
  'agent:started',
  'agent:completed',
  'agent:failed',
  'agent:idle',
  'agent:created',
  'agent:deleted',
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function colorFor(type: string, data: Record<string, unknown>): HudFeedColorClass {
  if (type === 'agent:failed') return 'err';
  if (type === 'agent:status-changed') {
    const status = str(data.status);
    if (status === 'error' || status === 'failed') return 'err';
    if (status === 'waiting') return 'warn';
    if (status === 'completed') return 'ok';
    return 'info';
  }
  if (type === 'agent:completed' || type === 'agent:idle') return 'ok';
  if (type === 'task:status-changed') {
    return str(data.newStatus) === 'complete' ? 'ok' : 'info';
  }
  if (type === 'workspace:displayStatus-changed') {
    const status = str(data.displayStatus);
    if (status === 'pr_merged' || status === 'complete') return 'ok';
    if (status === 'pr_ready' || status === 'pr_open') return 'accent';
    return 'info';
  }
  if (type === 'workspace:attention-changed') {
    return str(data.attention) === 'none' ? 'info' : 'warn';
  }
  if (type.startsWith('pr:')) return 'accent';
  return 'info';
}

/** Wire-derived detail text per event family. */
function textFor(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'agent:started':
    case 'agent:created':
    case 'agent:deleted':
      return str(data.agentName) ?? str(data.agentId) ?? '';
    case 'agent:completed':
    case 'agent:idle':
      return str(data.agentName) ?? str(data.agentId) ?? '';
    case 'agent:failed':
      return [str(data.agentId), str(data.error)].filter(Boolean).join(': ');
    case 'agent:status-changed':
      return [str(data.agentId), str(data.status)].filter(Boolean).join(' → ');
    case 'task:status-changed':
      return [str(data.noteTitle) ?? str(data.noteId), str(data.newStatus)]
        .filter(Boolean)
        .join(' → ');
    case 'workspace:displayStatus-changed':
      return str(data.displayStatus) ?? '';
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
 * Map one daemon event to a feed entry, or null when the type is not a feed
 * family or the envelope is missing its identity fields.
 */
export function mapEventToFeedEntry(event: WorkspaceEvent): HudFeedEntry | null {
  const type = typeof event.type === 'string' ? event.type : '';
  if (!(HUD_FEED_EVENT_TYPES as readonly string[]).includes(type)) return null;
  const id = str(event.id);
  const ts = str(event.timestamp);
  const workspaceId = str(event.workspaceId);
  if (!id || !ts || !workspaceId) return null;
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  return {
    id,
    ts,
    colorClass: colorFor(type, data),
    source: workspaceId,
    kind: type,
    text: textFor(type, data),
  };
}

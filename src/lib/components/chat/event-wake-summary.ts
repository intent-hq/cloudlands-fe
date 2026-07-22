/**
 * Shared, dependency-light helpers for summarizing workspace event wakes
 * (`[WORKSPACE EVENTS]` notifications) in the chat UI. Used by both
 * EventWakeupBanner (divider banner) and QueuedMessageList (queued rows).
 */

export interface EventWakeMetadata {
  type?: string;
  eventCount?: number;
  eventTypes?: string[];
  events?: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }>;
}

export interface ParsedAgentEvent {
  type: string;
  agentId: string;
  agentName?: string;
  completionReport?: string;
  lastResponseSummary?: string;
}

/** Parse agent events from message text and/or metadata. */
export function parseAgentEvents(
  text: string,
  metadata?: EventWakeMetadata,
): ParsedAgentEvent[] {
  // Use a Map to deduplicate by agentId (later events override earlier ones)
  const agentMap = new Map<string, ParsedAgentEvent>();

  // First, try to use events from metadata (preferred - has completionReport and lastResponseSummary)
  if (metadata?.events && metadata.events.length > 0) {
    for (const event of metadata.events) {
      const data = event.data as Record<string, unknown>;
      const agentId = data.agentId as string | undefined;
      if (agentId && (event.type === 'agent:idle' || event.type === 'agent:created')) {
        agentMap.set(agentId, {
          type: event.type,
          agentId,
          agentName: data.agentName as string | undefined,
          completionReport: data.completionReport as string | undefined,
          lastResponseSummary: data.lastResponseSummary as string | undefined,
        });
      }
    }
    return Array.from(agentMap.values());
  }

  // Fallback: parse from message text (legacy support)
  if (!text) return [];

  const lines = text.split('\n');

  for (const line of lines) {
    const eventMatch = line.match(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/);
    if (eventMatch) {
      const rawSummary = eventMatch[2];
      const agentIdMatch = rawSummary.match(/\{\{agentId:([^}]+)\}\}/);
      let agentId = agentIdMatch?.[1];
      if (!agentId) {
        const oldFormatMatch = rawSummary.match(/\((agent-[a-f0-9-]+)\)/i);
        agentId = oldFormatMatch?.[1];
      }
      const agentNameMatch = rawSummary.match(/"([^"]+)"/);
      const agentName = agentNameMatch?.[1];
      if (agentId && (eventMatch[1] === 'agent:idle' || eventMatch[1] === 'agent:created')) {
        agentMap.set(agentId, { type: eventMatch[1], agentId, agentName });
      }
    }
  }

  return Array.from(agentMap.values());
}

/** Ordered mapping of non-agent event-type prefixes to human category labels. */
const EVENT_CATEGORY_LABELS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['file:', 'file changes'],
  ['task:', 'task updates'],
  ['note:', 'note changes'],
  ['git:', 'git activity'],
  ['terminal:', 'terminal activity'],
  ['test:', 'test activity'],
  ['build:', 'build activity'],
  ['comment:', 'comment updates'],
  ['workspace:', 'workspace updates'],
  ['spec:', 'spec updates'],
  ['goal:', 'goal updates'],
];

/** Map non-agent event types to human category labels (e.g. "file changes"). */
export function categorizeEventTypes(types: string[]): string[] {
  return EVENT_CATEGORY_LABELS.filter(([prefix]) => types.some((t) => t.startsWith(prefix))).map(
    ([, label]) => label,
  );
}

const PREVIEW_MAX_LENGTH = 120;

function truncatePreview(text: string): string {
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH - 1)}…` : text;
}

/** Numbered event lines from the wake message text, without the "N. " prefix. */
function extractEventLines(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /^\d+\.\s*\[[^\]]+\]/.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, ''));
}

/**
 * Short human label + muted report preview for an event-notification wake.
 * Agent events get named labels; non-agent events get category labels derived
 * from `metadata.eventTypes`; otherwise falls back to an event count. Legacy
 * wakes without structured metadata get a truncated first-event-line preview.
 */
export function summarizeEventWake(
  content: string,
  messageMetadata?: Record<string, unknown>,
): { label: string; preview?: string } {
  const metadata = messageMetadata as EventWakeMetadata | undefined;
  const structured = Array.isArray(metadata?.events) ? metadata : undefined;

  // Parse resiliently: messageMetadata is opaque, so an unexpected shape
  // falls back to parseAgentEvents' legacy text parsing instead of erroring.
  let events: ParsedAgentEvent[];
  try {
    events = parseAgentEvents(content, structured);
  } catch {
    try {
      events = structured ? parseAgentEvents(content) : [];
    } catch {
      events = [];
    }
  }

  const idle = events.filter((e) => e.type === 'agent:idle');
  const created = events.filter((e) => e.type === 'agent:created');
  const parts: string[] = [];
  if (idle.length === 1) {
    parts.push(`Child agent ${idle[0].agentName ?? idle[0].agentId} completed`);
  } else if (idle.length > 1) {
    parts.push(`${idle.length} child agents completed`);
  }
  if (created.length === 1) {
    parts.push(`Child agent ${created[0].agentName ?? created[0].agentId} created`);
  } else if (created.length > 1) {
    parts.push(`${created.length} child agents created`);
  }

  const types = Array.isArray(metadata?.eventTypes)
    ? metadata.eventTypes.filter((t): t is string => typeof t === 'string')
    : [];
  parts.push(...categorizeEventTypes(types));

  const eventLines = extractEventLines(content);
  let label: string;
  if (parts.length > 0) {
    label = parts.join(' · ');
  } else {
    const count =
      typeof metadata?.eventCount === 'number' && metadata.eventCount > 0
        ? metadata.eventCount
        : structured?.events?.length || eventLines.length;
    label = count > 0 ? `${count} workspace event${count === 1 ? '' : 's'}` : 'Workspace events';
  }

  const withReport = idle.find((e) => e.completionReport || e.lastResponseSummary);
  let preview = withReport?.completionReport ?? withReport?.lastResponseSummary;
  if (!preview && parts.length === 0 && eventLines.length > 0) {
    preview = truncatePreview(eventLines[0]);
  }

  return { label, preview };
}

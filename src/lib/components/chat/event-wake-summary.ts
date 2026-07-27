/**
 * Shared, dependency-light helpers for summarizing workspace event wakes
 * (`[WORKSPACE EVENTS]` notifications) in the chat UI. Used by both
 * EventWakeupBanner (divider banner) and QueuedMessageList (queued rows).
 */

import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

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

/** Event types that mean a child agent finished its work. */
const COMPLETION_EVENT_TYPES: ReadonlySet<string> = new Set(['agent:idle', 'agent:reportToParent']);

/** First value that is a non-empty (non-whitespace) string, if any. */
export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Parse agent events from message text and/or metadata. */
export function parseAgentEvents(text: string, metadata?: EventWakeMetadata): ParsedAgentEvent[] {
  // Use a Map to deduplicate by agentId (later events override earlier ones)
  const agentMap = new Map<string, ParsedAgentEvent>();

  // First, try to use events from metadata (preferred - has completionReport and lastResponseSummary)
  if (metadata?.events && metadata.events.length > 0) {
    for (const event of metadata.events) {
      const data = event.data as Record<string, unknown>;
      const agentId = data.agentId as string | undefined;
      if (agentId && (COMPLETION_EVENT_TYPES.has(event.type) || event.type === 'agent:created')) {
        agentMap.set(agentId, {
          type: event.type,
          agentId,
          agentName: data.agentName as string | undefined,
          completionReport: firstNonEmptyString(data.completionReport, data.report),
          lastResponseSummary: firstNonEmptyString(data.lastResponseSummary),
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
      if (
        agentId &&
        (COMPLETION_EVENT_TYPES.has(eventMatch[1]) || eventMatch[1] === 'agent:created')
      ) {
        agentMap.set(agentId, { type: eventMatch[1], agentId, agentName });
      }
    }
  }

  return Array.from(agentMap.values());
}

/** Ordered mapping of non-agent event-type prefixes to human category labels. */
const EVENT_CATEGORY_LABELS: ReadonlyArray<readonly [prefix: string, label: () => string]> = [
  ['file:', () => m.chat_eventWake_category_fileChanges()],
  ['task:', () => m.chat_eventWake_category_taskUpdates()],
  ['note:', () => m.chat_eventWake_category_noteChanges()],
  ['git:', () => m.chat_eventWake_category_gitActivity()],
  ['terminal:', () => m.chat_eventWake_category_terminalActivity()],
  ['test:', () => m.chat_eventWake_category_testActivity()],
  ['build:', () => m.chat_eventWake_category_buildActivity()],
  ['comment:', () => m.chat_eventWake_category_commentUpdates()],
  ['workspace:', () => m.chat_eventWake_category_workspaceUpdates()],
  ['spec:', () => m.chat_eventWake_category_specUpdates()],
  ['goal:', () => m.chat_eventWake_category_goalUpdates()],
];

/** Map non-agent event types to human category labels (e.g. "file changes"). */
export function categorizeEventTypes(types: string[]): string[] {
  return EVENT_CATEGORY_LABELS.filter(([prefix]) => types.some((t) => t.startsWith(prefix))).map(
    ([, label]) => label(),
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

  const completed = events.filter((e) => COMPLETION_EVENT_TYPES.has(e.type));
  const created = events.filter((e) => e.type === 'agent:created');
  const parts: string[] = [];
  if (completed.length === 1) {
    parts.push(
      m.chat_eventWake_childCompleted_named({
        name: completed[0].agentName ?? completed[0].agentId,
      }),
    );
  } else if (completed.length > 1) {
    parts.push(m.chat_eventWake_childCompleted_many({ count: formatInteger(completed.length) }));
  }
  if (created.length === 1) {
    parts.push(
      m.chat_eventWake_childCreated_named({ name: created[0].agentName ?? created[0].agentId }),
    );
  } else if (created.length > 1) {
    parts.push(m.chat_eventWake_childCreated_many({ count: formatInteger(created.length) }));
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
    label =
      count > 0
        ? count === 1
          ? m.chat_eventWake_workspaceEvents_one({ count: formatInteger(count) })
          : m.chat_eventWake_workspaceEvents_many({ count: formatInteger(count) })
        : m.chat_eventWake_workspaceEvents_fallback();
  }

  const withReport = completed.find((e) => e.completionReport || e.lastResponseSummary);
  let preview = withReport?.completionReport ?? withReport?.lastResponseSummary;
  if (!preview && parts.length === 0) {
    if (eventLines.length > 0) {
      preview = truncatePreview(eventLines[0]);
    } else {
      // Rust daemon wakes are a single unnumbered "[WORKSPACE EVENTS] …" line;
      // strip the prefix and skip the generic wake header boilerplate.
      const firstLine = (content.split('\n')[0] ?? '')
        .replace(/^\[WORKSPACE EVENTS\]\s*/, '')
        .trim();
      if (firstLine && !/^You have been woken up by/i.test(firstLine)) {
        preview = truncatePreview(firstLine);
      }
    }
  }

  return { label, preview };
}

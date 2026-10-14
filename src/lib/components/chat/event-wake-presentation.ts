/** Canonical event-wake presentation extracted from EventWakeupBanner.
 * Renderer owners provide current session names; this module has no Store or effects.
 */
import { getActivityLabel } from '../../../features/events/activity-labels';
import type { WorkspaceEvent } from '$features/events/types';
import { m } from '$shared/paraglide/messages.js';
import { looksLikeAgentId } from '$shared/utils/agent-name-utils';
import { formatDateTime, formatInteger } from '$lib/i18n/format';
import {
  categorizeEventTypes,
  firstNonEmptyString,
  parseLegacyEventLine,
} from './event-wake-summary';

interface EventData {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface EventWakeMetadata {
  type: 'event_notification';
  eventCount: number;
  eventTypes: string[];
  events?: EventData[]; // Raw event data including completionReport for agent:idle events
}

export function getEventWakePresentation({
  metadata,
  messageText = '',
  workspaceId = '',
  showAgentCards = true,
  getAgentName,
}: {
  metadata?: EventWakeMetadata;
  messageText?: string;
  workspaceId?: string;
  showAgentCards?: boolean;
  getAgentName?: (agentId: string) => string | undefined;
}) {
  /**
   * Best display name for an event's agent: the payload's name field, else a
   * live agent-session store lookup by agentId — never an id-shaped value.
   * Undefined when unresolvable so callers fall back to generic labels.
   */
  function resolveAgentName(data: Record<string, unknown>): string | undefined {
    const wireName = firstNonEmptyString(data.agentName, data.name);
    if (wireName && !looksLikeAgentId(wireName)) return wireName;
    const agentId = firstNonEmptyString(data.agentId);
    const stored = agentId ? getAgentName?.(agentId) : undefined;
    return stored && !looksLikeAgentId(stored) ? stored : undefined;
  }

  function localizedActivityLabel(type: string, data: Record<string, unknown>): string {
    const name = resolveAgentName(data);
    if (name) {
      if (type === 'agent:idle') {
        return m.events_activity_nameFinished_label({ name });
      }
      if (type === 'agent:reportToParent') {
        return m.events_activity_nameSentMessage_label({ name });
      }
      if (type === 'agent:completed') return m.events_activity_nameCompleted_label({ name });
      if (type === 'agent:failed') return m.events_activity_nameFailed_label({ name });
      if (type === 'agent:created')
        return m.events_activity_createdAgentName_label({ agentName: name });
      if (type === 'agent:status-changed') {
        const status = firstNonEmptyString(data.status, data.newStatus);
        if (
          [
            'waiting',
            'waiting_for_input',
            'discussion_needed',
            'blocked',
            'review_required',
          ].includes(status ?? '')
        ) {
          return m.events_activity_nameIsWaiting_label({ name });
        }
        if (status === 'failed' || status === 'error') {
          return m.events_activity_nameEncounteredError_label({ name });
        }
      }
    }

    // Strip id-shaped name fields so getActivityLabel's generators fall back
    // to their generic labels instead of rendering a raw agent id.
    const safeData: Record<string, unknown> = { ...data };
    for (const field of ['agentName', 'name'] as const) {
      const value = safeData[field];
      if (typeof value === 'string' && looksLikeAgentId(value)) delete safeData[field];
    }
    return getActivityLabel({
      id: '',
      workspaceId: workspaceId,
      timestamp: '',
      type: type as WorkspaceEvent['type'],
      actor: { type: 'agent', name },
      data: safeData,
    });
  }

  function joinActivityLabels(labels: string[]): string {
    return labels.reduce((summary, label) =>
      summary ? m.chat_eventWakeup_summaryJoin_label({ first: summary, second: label }) : label,
    );
  }

  const parsedEvents = ((): ParsedEvent[] => {
    // First, try to use events from metadata (preferred - has completionReport and lastResponseSummary)
    if (metadata?.events && metadata.events.length > 0) {
      return metadata.events.map((event) => {
        const data = event.data as Record<string, unknown>;
        return {
          type: event.type,
          agentId: data.agentId as string | undefined,
          agentName: resolveAgentName(data),
          completionReport: firstNonEmptyString(data.completionReport, data.report),
          lastResponseSummary: data.lastResponseSummary as string | undefined,
        };
      });
    }

    // Fallback: parse from message text (legacy support)
    if (!messageText) return [];

    const events: ParsedEvent[] = [];
    const lines = messageText.split('\n');

    for (const line of lines) {
      // Match numbered event line: "1. [agent:idle] ..."
      const eventMatch = line.match(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/);
      if (eventMatch) {
        const { agentId, agentName } = parseLegacyEventLine(eventMatch[2]);
        events.push({
          type: eventMatch[1],
          agentId,
          agentName,
        });
      }
    }

    return events;
  })();

  // Describe small wakes in daemon order. Large bursts remain count-only.
  const friendlySummary = ((): string => {
    const types = metadata?.eventTypes || [];
    const structured = Array.isArray(metadata?.events) ? metadata.events : [];
    const legacy =
      structured.length === 0
        ? parsedEvents.map((event) => ({
            type: event.type,
            data: { agentId: event.agentId, agentName: event.agentName },
          }))
        : [];
    const events =
      structured.length > 0
        ? structured
        : legacy.length > 0
          ? legacy
          : types.map((type) => ({ type, data: {} }));
    const count = metadata?.eventCount || events.length;

    if (count >= 5) {
      return m.chat_eventWakeup_eventCount_many({ count: formatInteger(count) });
    }
    if (events.length === 0) return m.chat_eventWakeup_subscriptionUpdate_label();

    const labels: string[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      const label = localizedActivityLabel(event.type, event.data);
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
    return labels.length > 0
      ? joinActivityLabels(labels)
      : count === 1
        ? m.chat_eventWakeup_eventCount_one({ count: formatInteger(count) })
        : m.chat_eventWakeup_eventCount_many({ count: formatInteger(count) });
  })();

  const agentSummaryRoles = ((): { name: string; status: string } | null => {
    if ((metadata?.eventCount ?? 0) !== 1) return null;
    const event = Array.isArray(metadata?.events) ? metadata.events[0] : undefined;
    if (!event || (event.type !== 'agent:idle' && event.type !== 'agent:reportToParent')) {
      return null;
    }
    const data = 'data' in event ? event.data : event;
    const name = resolveAgentName(data);
    if (!name) return null;
    return {
      name,
      status:
        event.type === 'agent:reportToParent'
          ? m.chat_msgAttribution_sentMessage_after()
          : m.events_activity_partFinished_label().trim(),
    };
  })();

  // Parse event details from message text
  interface ParsedEvent {
    type: string;
    agentId?: string;
    agentName?: string;
    completionReport?: string;
    lastResponseSummary?: string;
  }

  interface EventDetail {
    key: string;
    type: string;
    agentId?: string;
    label: string;
    agentName?: string;
    datetime?: string;
    timestamp?: string;
    summary?: string;
  }

  function eventTypeLabel(type: string): string {
    if (type === 'agent:idle') return m.chat_eventWakeup_agentFinished_label();
    if (type === 'agent:reportToParent') return m.events_activity_partFinished_label().trim();
    if (type === 'agent:created') return m.chat_eventWakeup_newAgent_label();
    return categorizeEventTypes([type])[0] ?? type;
  }

  function isAgentIdentityEvent(type: string): boolean {
    return type === 'agent:idle' || type === 'agent:reportToParent' || type === 'agent:created';
  }

  function isAgentCompletionEvent(type: string): boolean {
    return type === 'agent:idle' || type === 'agent:reportToParent';
  }

  function agentStatusLabel(type: string): string {
    return type === 'agent:reportToParent'
      ? m.chat_msgAttribution_sentMessage_after()
      : m.events_activity_partFinished_label().trim();
  }

  const eventDetails = ((): EventDetail[] => {
    if (!Array.isArray(metadata?.events)) return [];
    const occurrences = new Map<string, number>();

    // Preserve daemon order and duplicates: each entry represents a distinct trigger.
    return metadata.events.flatMap((event) => {
      if (!event || typeof event.type !== 'string') return [];
      const data =
        event.data && typeof event.data === 'object' && !Array.isArray(event.data)
          ? event.data
          : {};
      const datetime = typeof event.timestamp === 'string' ? event.timestamp : undefined;
      const timestamp = datetime ? formatDateTime(datetime) : '';
      const agentId = firstNonEmptyString(data.agentId);
      const summary = firstNonEmptyString(
        data.completionReport,
        data.report,
        data.lastResponseSummary,
      );
      const identity = `${event.type}:${datetime ?? ''}:${agentId ?? ''}:${summary ?? ''}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return [
        {
          key: `${identity}:${occurrence}`,
          type: event.type,
          agentId,
          label: eventTypeLabel(event.type),
          agentName: resolveAgentName(data),
          datetime,
          timestamp: timestamp || undefined,
          summary,
        },
      ];
    });
  })();

  const legacyEventTypes =
    eventDetails.length === 0 && Array.isArray(metadata?.eventTypes)
      ? metadata.eventTypes.filter((type): type is string => typeof type === 'string')
      : [];

  // Get agent events with IDs for displaying cards
  // IMPORTANT: Deduplicate by agentId to prevent each_key_duplicate errors
  // Later events for the same agent override earlier ones (matching parseAgentEvents behavior)
  const agentEvents = (() => {
    const agentMap = new Map<
      string,
      {
        type: string;
        agentId: string;
        agentName?: string;
        completionReport?: string;
        lastResponseSummary?: string;
      }
    >();

    for (const e of parsedEvents) {
      if (e.agentId && isAgentIdentityEvent(e.type)) {
        // Later events override earlier ones for the same agent
        agentMap.set(e.agentId, {
          type: e.type,
          agentId: e.agentId,
          agentName: e.agentName,
          completionReport: e.completionReport,
          lastResponseSummary: e.lastResponseSummary,
        });
      }
    }

    return Array.from(agentMap.values());
  })();
  function usesHeaderAgentIdentity(event: EventDetail): boolean {
    return (
      showAgentCards &&
      !!event.agentId &&
      isAgentIdentityEvent(event.type) &&
      agentEvents.some((agentEvent) => agentEvent.agentId === event.agentId)
    );
  }

  const displayEventDetails = eventDetails.filter(
    (event) => !usesHeaderAgentIdentity(event) || !!event.summary || !!event.timestamp,
  );
  const displayLegacyEventTypes = legacyEventTypes.filter(
    (type) => !(showAgentCards && agentEvents.length > 0 && isAgentIdentityEvent(type)),
  );

  return {
    friendlySummary,
    agentSummaryRoles,
    agentEvents,
    displayEventDetails,
    displayLegacyEventTypes,
    eventTypeLabel,
    isAgentCompletionEvent,
    agentStatusLabel,
    usesHeaderAgentIdentity,
  };
}

<script lang="ts" module>
  interface EventMetadataForParsing {
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

  /** Parse agent events from message text and/or metadata - exported for use in ChatPanel */
  export function parseAgentEvents(
    text: string,
    metadata?: EventMetadataForParsing,
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
        let agentIdMatch = rawSummary.match(/\{\{agentId:([^}]+)\}\}/);
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
</script>

<script lang="ts">
  /**
   * EventWakeupBanner Component
   *
   * Shows a sleek divider when an agent is woken up from an event subscription.
   * Displays the event types in a compact, centered divider format (similar to DateSeparator).
   * Can optionally show full event details in an expandable format.
   */
  import { faBell, faRotate, faArrowUp } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { fade, slide } from 'svelte/transition';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Button from '$lib/components/ui/button/button.svelte';
  import AgentCard from './AgentCard.svelte';

  interface EventData {
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }

  interface EventMetadata {
    type: 'event_notification';
    eventCount: number;
    eventTypes: string[];
    events?: EventData[]; // Raw event data including completionReport for agent:idle events
  }

  interface Props {
    metadata: EventMetadata;
    /** If true, renders as a full-width divider. Otherwise renders inline. */
    asDivider?: boolean;
    /** The raw event message text to parse and display */
    messageText?: string;
    /** Whether this banner is currently in sticky position */
    isSticky?: boolean;
    /** Called when user wants to scroll to previous user message */
    onScrollToPrevious?: () => void;
    /** Whether to show the summary row (default: true) */
    showSummary?: boolean;
    /** Whether to show agent cards (default: true) */
    showAgentCards?: boolean;
  }

  let {
    metadata,
    asDivider = false,
    messageText = '',
    isSticky = false,
    onScrollToPrevious,
    showSummary = true,
    showAgentCards = true,
  }: Props = $props();

  // Get a friendly summary description for the banner
  // Note: This is a function that uses parsedEvents, which is $derived
  // We access parsedEvents directly since it's already reactive
  const friendlySummary = $derived.by((): string => {
    const types = metadata?.eventTypes || [];
    if (types.length === 0) return 'Subscription update';

    // Get agent names from parsed events for agent:idle events
    const idleAgentNames = parsedEvents
      .filter((e) => e.type === 'agent:idle' && e.agentName)
      .map((e) => e.agentName!);

    const createdAgentNames = parsedEvents
      .filter((e) => e.type === 'agent:created' && e.agentName)
      .map((e) => e.agentName!);

    // Count agent events from metadata types (fallback when parsing fails)
    const agentIdleCount = types.filter((t) => t === 'agent:idle').length;
    const agentCreatedCount = types.filter((t) => t === 'agent:created').length;
    const hasFileChanges = types.some((t) => t.startsWith('file:'));
    const hasTaskUpdates = types.some((t) => t.startsWith('task:'));
    const hasNoteUpdates = types.some((t) => t.startsWith('note:'));

    // Build summary with agent names when available
    const parts: string[] = [];

    if (idleAgentNames.length > 0) {
      // We have parsed agent names - use them
      if (idleAgentNames.length === 1) {
        parts.push(`${idleAgentNames[0]} finished`);
      } else if (idleAgentNames.length === 2) {
        parts.push(`${idleAgentNames[0]} & ${idleAgentNames[1]} finished`);
      } else {
        parts.push(`${idleAgentNames[0]} +${idleAgentNames.length - 1} finished`);
      }
    } else if (agentIdleCount > 0) {
      // Fallback: we know there are idle events but couldn't parse names
      parts.push(agentIdleCount === 1 ? 'Agent finished' : `${agentIdleCount} agents finished`);
    }

    if (createdAgentNames.length > 0) {
      if (createdAgentNames.length === 1) {
        parts.push(`New: ${createdAgentNames[0]}`);
      } else {
        parts.push(`${createdAgentNames.length} new agents`);
      }
    } else if (agentCreatedCount > 0) {
      // Fallback: we know there are created events but couldn't parse names
      parts.push(agentCreatedCount === 1 ? 'New agent' : `${agentCreatedCount} new agents`);
    }

    if (hasFileChanges) parts.push('file changes');
    if (hasTaskUpdates) parts.push('task updates');
    if (hasNoteUpdates) parts.push('note changes');

    if (parts.length === 0) return `${types.length} events`;
    if (parts.length === 1) return parts[0];
    return parts.slice(0, 2).join(' & ');
  });

  // Parse event details from message text
  interface ParsedEvent {
    type: string;
    agentId?: string;
    agentName?: string;
    completionReport?: string;
    lastResponseSummary?: string;
  }

  const parsedEvents = $derived.by((): ParsedEvent[] => {
    // First, try to use events from metadata (preferred - has completionReport and lastResponseSummary)
    if (metadata?.events && metadata.events.length > 0) {
      return metadata.events.map((event) => {
        const data = event.data as Record<string, unknown>;
        return {
          type: event.type,
          agentId: data.agentId as string | undefined,
          agentName: data.agentName as string | undefined,
          completionReport: data.completionReport as string | undefined,
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
        const rawSummary = eventMatch[2];

        // Extract agentId - try new format first: {{agentId:xxx}}
        let agentIdMatch = rawSummary.match(/\{\{agentId:([^}]+)\}\}/);
        let agentId = agentIdMatch?.[1];

        // Fallback: try old format with ID in parentheses: (agent-xxx-xxx-xxx)
        if (!agentId) {
          const oldFormatMatch = rawSummary.match(/\((agent-[a-f0-9-]+)\)/i);
          agentId = oldFormatMatch?.[1];
        }

        // Extract agent name from quotes: "AgentName"
        const agentNameMatch = rawSummary.match(/"([^"]+)"/);
        const agentName = agentNameMatch?.[1];

        events.push({
          type: eventMatch[1],
          agentId,
          agentName,
        });
      }
    }

    return events;
  });

  // Get agent events with IDs for displaying cards
  // IMPORTANT: Deduplicate by agentId to prevent each_key_duplicate errors (AUGMENT-INTENT-2A)
  // Later events for the same agent override earlier ones (matching parseAgentEvents behavior)
  const agentEvents = $derived.by(() => {
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
      if (e.agentId && (e.type === 'agent:idle' || e.type === 'agent:created')) {
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
  });
</script>

{#if asDivider}
  <!-- Divider style - can show summary, agent cards, or both -->
  <div
    class="event-wakeup-banner group/banner w-full min-w-0"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <!-- Summary row -->
    {#if showSummary}
      <div class="flex items-center w-full min-w-0 py-1 bg-sidebar">
        <!-- Provider ensures proper context and cleanup during component destruction -->
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger class="shrink-0 min-w-0 flex-1">
              <div class="w-full min-w-0 flex items-center gap-2 px-3 py-1 text-subtle">
                <Fa icon={faBell} size="xs" class="text-ghost" />
                <span class=" flex-1 min-w-0 truncate text-left">{friendlySummary}</span>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="">
              <p class="font-medium">Subscription wakeup</p>
              <p class="text-subtle mt-0.5">
                {metadata?.eventCount ?? 0}
                {(metadata?.eventCount ?? 0) === 1 ? 'event' : 'events'} triggered this response
              </p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>

        <!-- Scroll to previous button (visible when sticky) -->
        {#if isSticky && onScrollToPrevious}
          <div
            class="absolute top-1 right-1 flex items-center gap-0.5 bg-sidebar/95 backdrop-blur-sm rounded-md border border-border opacity-0 group-hover/banner:opacity-100"
          >
            <Button
              variant="ghost-light"
              size="icon-xs"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onScrollToPrevious();
              }}
              title="Scroll to previous message"
            >
              <Fa icon={faArrowUp} class="w-2.5! h-2.5!" />
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Agent cards (non-sticky, scroll normally) -->
    {#if showAgentCards && agentEvents.length > 0}
      <div class="mt-1 pb-3 flex flex-col gap-0.5 px-2">
        {#each agentEvents.slice(0, 5) as event (event.agentId)}
          <AgentCard
            agentId={event.agentId!}
            agentName={event.agentName}
            completionReport={event.completionReport}
            lastResponseSummary={event.lastResponseSummary}
          />
        {/each}
        {#if agentEvents.length > 5}
          <div class="text-ui text-subtle text-center py-1">
            +{agentEvents.length - 5} more agents
          </div>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <!-- Inline style - compact banner inside message -->
  <div
    class="event-wakeup-banner flex items-center gap-1.5 px-2 py-0.5 mb-1 rounded text-xs text-subtle"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <Fa icon={faRotate} class="w-2 h-2" />
    <span>{friendlySummary}</span>
  </div>
{/if}

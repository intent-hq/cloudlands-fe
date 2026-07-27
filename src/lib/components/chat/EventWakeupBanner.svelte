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
  import { slide } from 'svelte/transition';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Button from '$lib/components/ui/button/button.svelte';
  import AgentCard from './AgentCard.svelte';
  import { categorizeEventTypes, firstNonEmptyString } from './event-wake-summary';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

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
    /** Optional workspace for scoping AgentCard subscriptions (prevents cross-workspace bleed) */
    workspace?: Workspace | null;
  }

  let {
    metadata,
    asDivider = false,
    messageText = '',
    isSticky = false,
    onScrollToPrevious,
    showSummary = true,
    showAgentCards = true,
    workspace = null,
  }: Props = $props();

  // Get a friendly summary description for the banner
  // Note: This is a function that uses parsedEvents, which is $derived
  // We access parsedEvents directly since it's already reactive
  const friendlySummary = $derived.by((): string => {
    const types = metadata?.eventTypes || [];
    if (types.length === 0) return m.chat_eventWakeup_subscriptionUpdate_label();

    // Get agent names from parsed events for completion events
    const idleAgentNames = parsedEvents
      .filter((e) => (e.type === 'agent:idle' || e.type === 'agent:reportToParent') && e.agentName)
      .map((e) => e.agentName!);

    const createdAgentNames = parsedEvents
      .filter((e) => e.type === 'agent:created' && e.agentName)
      .map((e) => e.agentName!);

    // Count agent events from metadata types (fallback when parsing fails)
    const agentIdleCount = types.filter(
      (t) => t === 'agent:idle' || t === 'agent:reportToParent',
    ).length;
    const agentCreatedCount = types.filter((t) => t === 'agent:created').length;

    // Build summary with agent names when available
    const parts: string[] = [];

    if (idleAgentNames.length > 0) {
      // We have parsed agent names - use them
      if (idleAgentNames.length === 1) {
        parts.push(m.chat_eventWakeup_agentFinished_named({ name: idleAgentNames[0] }));
      } else if (idleAgentNames.length === 2) {
        parts.push(
          m.chat_eventWakeup_agentsFinished_pair({
            first: idleAgentNames[0],
            second: idleAgentNames[1],
          }),
        );
      } else {
        parts.push(
          m.chat_eventWakeup_agentsFinished_overflow({
            name: idleAgentNames[0],
            count: formatInteger(idleAgentNames.length - 1),
          }),
        );
      }
    } else if (agentIdleCount > 0) {
      // Fallback: we know there are idle events but couldn't parse names
      parts.push(
        agentIdleCount === 1
          ? m.chat_eventWakeup_agentFinished_label()
          : m.chat_eventWakeup_agentsFinished_many({ count: formatInteger(agentIdleCount) }),
      );
    }

    if (createdAgentNames.length > 0) {
      if (createdAgentNames.length === 1) {
        parts.push(m.chat_eventWakeup_newAgent_named({ name: createdAgentNames[0] }));
      } else {
        parts.push(
          m.chat_eventWakeup_newAgents_many({ count: formatInteger(createdAgentNames.length) }),
        );
      }
    } else if (agentCreatedCount > 0) {
      // Fallback: we know there are created events but couldn't parse names
      parts.push(
        agentCreatedCount === 1
          ? m.chat_eventWakeup_newAgent_label()
          : m.chat_eventWakeup_newAgents_many({ count: formatInteger(agentCreatedCount) }),
      );
    }

    parts.push(...categorizeEventTypes(types));

    if (parts.length === 0)
      return m.chat_eventWakeup_eventCount_many({ count: formatInteger(types.length) });
    if (parts.length === 1) return parts[0];
    return m.chat_eventWakeup_summaryJoin_label({ first: parts[0], second: parts[1] });
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
  // IMPORTANT: Deduplicate by agentId to prevent each_key_duplicate errors
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
      if (
        e.agentId &&
        (e.type === 'agent:idle' || e.type === 'agent:reportToParent' || e.type === 'agent:created')
      ) {
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
      <div class="relative flex items-center w-full min-w-0 py-1 bg-sidebar">
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
              <p class="font-medium">{m.chat_eventWakeup_subscriptionWakeup_tooltip()}</p>
              <p class="text-subtle mt-0.5">
                {(metadata?.eventCount ?? 0) === 1
                  ? m.chat_eventWakeup_triggered_one({
                      count: formatInteger(metadata?.eventCount ?? 0),
                    })
                  : m.chat_eventWakeup_triggered_many({
                      count: formatInteger(metadata?.eventCount ?? 0),
                    })}
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
              title={m.chat_eventWakeup_scrollToPrevious_title()}
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
            {workspace}
          />
        {/each}
        {#if agentEvents.length > 5}
          <div class="text-ui text-subtle text-center py-1">
            {m.chat_shared_moreAgents_label({ count: formatInteger(agentEvents.length - 5) })}
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

<script lang="ts">
  /**
   * EventWakeupBanner Component
   *
   * Shows a sleek divider when an agent is woken up from an event subscription.
   * Displays the event types in a compact, centered divider format (similar to DateSeparator).
   * Can optionally show full event details in an expandable format.
   */
  import { faBell, faChevronDown, faRotate } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import { safeSlide } from '$lib/utils/animations';
  import { getActivityLabel } from '$features/events/activity-labels';
  import type { WorkspaceEvent } from '$features/events/types';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import {
    categorizeEventTypes,
    firstNonEmptyString,
    parseLegacyEventLine,
  } from './event-wake-summary';
  import { looksLikeAgentId } from '$shared/utils/agent-name-utils';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
    SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
    SUBSCRIPTION_CARD_SURFACE_CLASS,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
    EVENT_WAKEUP_IN_THREAD_SPACING_CLASS,
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
  } from './subscription-disclosure';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatDateTime, formatInteger } from '$lib/i18n/format';
  import { store as appStore } from '$store/renderer/store';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';

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
    /** Keep the disclosure flat when it is already inside a card surface. */
    embedded?: boolean;
    /** Use the compact transcript rhythm for the card's external top gap. */
    compact?: boolean;
    /**
     * Drop the divider card's external top margin when the preceding
     * batched-delivery gap already owns the seam.
     */
    suppressTopGap?: boolean;
    /** The raw event message text to parse and display */
    messageText?: string;
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
    embedded = false,
    compact: _compact = false,
    suppressTopGap = false,
    messageText = '',
    showSummary = true,
    showAgentCards = true,
    workspace = null,
  }: Props = $props();

  const componentId = $props.id();
  const detailsId = `${componentId}-event-wakeup-details`;
  let detailsOpen = $state(false);

  // Bridge immutable Redux snapshots into local rune state so the derived
  // labels re-resolve agent names when a session lands after the banner
  // renders (e.g. async session load).
  let rendererState = $state.raw(appStore.state);
  const unsubscribeRendererState = appStore.getReadableState().subscribe((state) => {
    rendererState = state;
  });
  onDestroy(unsubscribeRendererState);

  /**
   * Best display name for an event's agent: the payload's name field, else a
   * live agent-session store lookup by agentId — never an id-shaped value.
   * Undefined when unresolvable so callers fall back to generic labels.
   */
  function resolveAgentName(data: Record<string, unknown>): string | undefined {
    const wireName = firstNonEmptyString(data.agentName, data.name);
    if (wireName && !looksLikeAgentId(wireName)) return wireName;
    const agentId = firstNonEmptyString(data.agentId);
    const stored = agentId ? selectAgentSession.select(rendererState, agentId)?.name : undefined;
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
      workspaceId: workspace?.id ? String(workspace.id) : '',
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

  // Describe small wakes in daemon order. Large bursts remain count-only.
  const friendlySummary = $derived.by((): string => {
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
  });

  const agentSummaryRoles = $derived.by((): { name: string; status: string } | null => {
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
  });

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

  const eventDetails = $derived.by((): EventDetail[] => {
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
  });

  const legacyEventTypes = $derived(
    eventDetails.length === 0 && Array.isArray(metadata?.eventTypes)
      ? metadata.eventTypes.filter((type): type is string => typeof type === 'string')
      : [],
  );

  const parsedEvents = $derived.by((): ParsedEvent[] => {
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
  });
  const agentEventsById = $derived(new Map(agentEvents.map((event) => [event.agentId, event])));
  const agentEventStackItems = $derived(
    agentEvents.map((event): AgentAvatarStackItem => ({
      key: event.agentId,
      agentId: event.agentId,
    })),
  );

  function usesHeaderAgentIdentity(event: EventDetail): boolean {
    return (
      showAgentCards &&
      !!event.agentId &&
      isAgentIdentityEvent(event.type) &&
      agentEvents.some((agentEvent) => agentEvent.agentId === event.agentId)
    );
  }

  const displayEventDetails = $derived(
    eventDetails.filter(
      (event) => !usesHeaderAgentIdentity(event) || !!event.summary || !!event.timestamp,
    ),
  );
  const displayLegacyEventTypes = $derived(
    legacyEventTypes.filter(
      (type) => !(showAgentCards && agentEvents.length > 0 && isAgentIdentityEvent(type)),
    ),
  );

  function openAgent(event: MouseEvent, agentId: string) {
    event.stopPropagation();
    if (!workspace?.id) return;
    appStore.dispatch(
      openAgentTabRequested(String(workspace.id), {
        agentId,
        sourcePanelId: findSourcePanelId(event.target),
        openInAdjacentPanel: event.metaKey || event.ctrlKey,
      }),
    );
  }
</script>

{#if asDivider}
  <!-- Transcript disclosure - can show summary, agent cards, or both. -->
  <div
    class="event-wakeup-banner group/banner {SUBSCRIPTION_CARD_CONTAINMENT_CLASS} {embedded
      ? ''
      : `${SUBSCRIPTION_CARD_SURFACE_CLASS} ${suppressTopGap ? 'mt-0' : EVENT_WAKEUP_IN_THREAD_SPACING_CLASS}`}"
    data-testid="event-wakeup-card"
    data-embedded={embedded}
    data-external-spacing-owner={!embedded && !suppressTopGap ? 'event-wakeup-card' : undefined}
    transition:safeSubscriptionSlide
  >
    <!-- Summary header and completed-agent details share one bounded surface. -->
    {#if showSummary || (showAgentCards && agentEvents.length > 0)}
      <div class="relative w-full min-w-0 max-w-full overflow-hidden">
        {#if showSummary}
          <div class={SUBSCRIPTION_DISCLOSURE_ROW_CLASS} data-testid="event-wakeup-header">
            {#if showAgentCards && agentEvents.length > 0}
              <div
                class="flex min-w-0 shrink-0 items-center overflow-hidden"
                data-testid="event-wakeup-avatar-stack"
              >
                {#snippet wakeupAvatar(item: AgentAvatarStackItem)}
                  {@const event = agentEventsById.get(item.agentId)}
                  {#if event}
                    <InlineAgentAvatar
                      agentId={event.agentId}
                      agentName={event.agentName}
                      {workspace}
                      isCompleted={event.type !== 'agent:created'}
                      onclick={(pointerEvent) => openAgent(pointerEvent, event.agentId)}
                    />
                  {/if}
                {/snippet}
                <AgentAvatarStack
                  items={agentEventStackItems}
                  maxVisible={5}
                  align="start"
                  interactive
                  variant="standard"
                  overflowTestId="event-wakeup-avatar-overflow"
                  itemContent={wakeupAvatar}
                />
              </div>
            {:else}
              <span
                class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
                aria-hidden="true"
                data-testid="event-wakeup-leading-column"
              >
                <Fa
                  icon={faBell}
                  size={14}
                  class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
                />
              </span>
            {/if}
            <button
              type="button"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={friendlySummary}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onclick={() => (detailsOpen = !detailsOpen)}
              data-testid="event-wakeup-summary"
            >
              {#if agentSummaryRoles}
                <span
                  class="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden"
                  title={friendlySummary}
                  aria-hidden="true"
                >
                  <strong
                    class="type-body min-w-0 truncate font-normal text-muted-foreground"
                    data-testid="event-wakeup-agent-name"
                  >
                    {agentSummaryRoles.name}
                  </strong>
                  <span
                    class="type-body min-w-0 shrink truncate font-normal text-muted-foreground"
                    data-testid="event-wakeup-status"
                  >
                    {agentSummaryRoles.status}
                  </span>
                </span>
              {:else}
                <span class="min-w-0 flex-1 truncate" title={friendlySummary} aria-hidden="true"
                  >{friendlySummary}</span
                >
              {/if}
              <span
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
                data-testid="event-wakeup-chevron-column"
              >
                <Fa
                  icon={faChevronDown}
                  size={16}
                  class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {detailsOpen
                    ? ''
                    : 'rotate-90'}"
                />
              </span>
            </button>
          </div>

          {#if detailsOpen}
            <div
              id={detailsId}
              class="w-full min-w-0 max-w-full overflow-hidden border-t border-border {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
              role="region"
              aria-label={m.chat_eventWakeup_subscriptionWakeup_tooltip()}
              data-testid="event-wakeup-details"
              transition:safeSubscriptionSlide
            >
              {#if displayEventDetails.length > 0}
                <ol class="min-w-0 space-y-2">
                  {#each displayEventDetails as event (event.key)}
                    <li
                      class="min-w-0 overflow-hidden"
                      data-testid="event-wakeup-detail"
                      data-event-detail-key={event.key}
                      transition:safeSubscriptionRowTransition
                    >
                      {#if !usesHeaderAgentIdentity(event)}
                        <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                          {#if event.agentName && isAgentCompletionEvent(event.type)}
                            <strong
                              class="type-body min-w-0 break-words font-medium text-foreground [overflow-wrap:anywhere]"
                            >
                              {event.agentName}
                            </strong>
                            <span class="type-caption font-normal text-muted-foreground">
                              {agentStatusLabel(event.type)}
                            </span>
                          {:else}
                            <span class="type-caption font-medium text-primary">{event.label}</span>
                            {#if event.agentName}
                              <span
                                class="type-caption min-w-0 break-words font-normal text-muted-foreground [overflow-wrap:anywhere]"
                              >
                                {event.agentName}
                              </span>
                            {/if}
                          {/if}
                        </div>
                      {/if}
                      {#if event.timestamp}
                        <time
                          class="type-caption mt-0.5 block w-fit tabular-nums font-normal text-subtle"
                          datetime={event.datetime}
                          data-testid="event-wakeup-timestamp"
                        >
                          {event.timestamp}
                        </time>
                      {/if}
                      {#if event.summary}
                        <p
                          class="type-body mt-1.5 w-full max-w-[68ch] whitespace-pre-wrap font-normal text-foreground [overflow-wrap:anywhere]"
                          data-testid="event-wakeup-report"
                        >
                          {event.summary}
                        </p>
                      {/if}
                    </li>
                  {/each}
                </ol>
              {:else if displayLegacyEventTypes.length > 0}
                <ul class="type-caption min-w-0 space-y-1 text-subtle">
                  {#each displayLegacyEventTypes as type, index (index)}
                    <li class="break-words [overflow-wrap:anywhere]">{eventTypeLabel(type)}</li>
                  {/each}
                </ul>
              {:else}
                <p class="type-caption text-subtle">
                  {(metadata?.eventCount ?? 0) === 1
                    ? m.chat_eventWakeup_triggered_one({
                        count: formatInteger(metadata?.eventCount ?? 0),
                      })
                    : m.chat_eventWakeup_triggered_many({
                        count: formatInteger(metadata?.eventCount ?? 0),
                      })}
                </p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <!-- Inline style - compact banner inside message -->
  <div
    class="event-wakeup-banner type-body mb-1 flex items-center gap-1.5 py-0.5 pr-2 pl-0 text-primary"
    transition:safeSlide={{ axis: 'y', duration: 200 }}
  >
    <Fa icon={faRotate} class="h-2 w-2 opacity-40" />
    <span>{friendlySummary}</span>
  </div>
{/if}

<script lang="ts">
  import { openAssistantAgentFromEvent } from '$lib/utils/assistant-agent-link';
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { CHAT_OPERATIONAL_ICON_CLASS } from './operational-disclosure-row';
  /**
   * EventWakeupBanner Component
   *
   * Shows a sleek divider when an agent is woken up from an event subscription.
   * Displays the event types in a compact, centered divider format (similar to DateSeparator).
   * Can optionally show full event details in an expandable format.
   */
  import { faBell, faChevronDown, faRotate } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { onDestroy } from 'svelte';
  import { safeDisclosureTransition } from './disclosure-motion';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import { getEventWakePresentation, type EventWakeMetadata } from './event-wake-presentation';
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
  import { formatInteger } from '$lib/i18n/format';
  import { store as appStore } from '$store/renderer/store';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';

  interface Props {
    metadata: EventWakeMetadata;
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
    /** Render only the compact pinned summary; activation returns to the source card. */
    onPinnedActivate?: () => void;
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
    onPinnedActivate,
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

  const presentation = $derived(
    getEventWakePresentation({
      metadata,
      messageText,
      workspaceId: workspace?.id ? String(workspace.id) : '',
      showAgentCards,
      getAgentName: (agentId) => selectAgentSession.select(rendererState, agentId)?.name,
    }),
  );
  const {
    friendlySummary,
    agentSummaryRoles,
    agentEvents,
    displayEventDetails,
    displayLegacyEventTypes,
    eventTypeLabel,
    isAgentCompletionEvent,
    agentStatusLabel,
    usesHeaderAgentIdentity,
  } = $derived(presentation);

  const agentEventsById = $derived(new Map(agentEvents.map((event) => [event.agentId, event])));
  const agentEventStackItems = $derived(
    agentEvents.map((event): AgentAvatarStackItem => ({
      key: event.agentId,
      agentId: event.agentId,
    })),
  );

  function openAgent(event: MouseEvent, agentId: string) {
    event.stopPropagation();
    if (onPinnedActivate) {
      onPinnedActivate();
      return;
    }
    if (!workspace?.id) return;
    if (openAssistantAgentFromEvent(event, String(workspace.id), agentId)) return;
    appStore.dispatch(
      openAgentTabRequested(String(workspace.id), {
        agentId,
        sourcePanelId: findSourcePanelId(event.target),
        openInAdjacentPanel: event.metaKey || event.ctrlKey,
      }),
    );
  }
</script>

{#if asDivider || onPinnedActivate}
  <!-- Transcript disclosure - can show summary, agent cards, or both. -->
  <div
    class="event-wakeup-banner group/banner {SUBSCRIPTION_CARD_CONTAINMENT_CLASS} {embedded
      ? ''
      : `${SUBSCRIPTION_CARD_SURFACE_CLASS} ${suppressTopGap || onPinnedActivate ? 'mt-0' : EVENT_WAKEUP_IN_THREAD_SPACING_CLASS}`}"
    class:pointer-events-auto={!!onPinnedActivate}
    data-testid={onPinnedActivate ? 'pinned-user-prompt' : 'event-wakeup-card'}
    data-embedded={embedded}
    data-external-spacing-owner={!embedded && !suppressTopGap && !onPinnedActivate
      ? 'event-wakeup-card'
      : undefined}
    transition:safeSubscriptionSlide
  >
    <!-- Summary header and completed-agent details share one bounded surface. -->
    {#if showSummary || (showAgentCards && agentEvents.length > 0)}
      <div class="relative w-full min-w-0 max-w-full overflow-hidden">
        {#if showSummary}
          <!-- svelte-ignore a11y_click_events_have_key_events (pinned activation lives on the sibling summary and avatar buttons) -->
          <!-- svelte-ignore a11y_no_static_element_interactions (only enlarges the pinned buttons' hit area) -->
          <div
            class={SUBSCRIPTION_DISCLOSURE_ROW_CLASS}
            data-testid="event-wakeup-header"
            onclick={onPinnedActivate ? () => onPinnedActivate?.() : undefined}
          >
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
                      activationLabel={onPinnedActivate
                        ? m.chat_stickyMessageHeader_scrollToPrevious_title()
                        : undefined}
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
                  size={16}
                  class="{CHAT_OPERATIONAL_ICON_CLASS} {SUBSCRIPTION_ICON_CLASS}"
                />
              </span>
            {/if}
            <Button
              type="button"
              variant="plain"
              class="type-body flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={onPinnedActivate
                ? m.chat_stickyMessageHeader_scrollToPrevious_title()
                : friendlySummary}
              aria-expanded={onPinnedActivate ? undefined : detailsOpen}
              aria-controls={onPinnedActivate ? undefined : detailsId}
              onclick={(event) => {
                if (onPinnedActivate) {
                  event.stopPropagation();
                  onPinnedActivate();
                } else detailsOpen = !detailsOpen;
              }}
              data-testid="event-wakeup-summary"
            >
              {#if agentSummaryRoles}
                <span
                  class="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden"
                  aria-hidden="true"
                >
                  <strong
                    class="type-body min-w-0 truncate font-normal text-muted-foreground"
                    data-testid="event-wakeup-agent-name"
                    use:truncatedTitle={agentSummaryRoles.name}
                  >
                    {agentSummaryRoles.name}
                  </strong>
                  <span
                    class="type-body min-w-0 shrink truncate font-normal text-muted-foreground"
                    data-testid="event-wakeup-status"
                    use:truncatedTitle={agentSummaryRoles.status}
                  >
                    {agentSummaryRoles.status}
                  </span>
                </span>
              {:else}
                <span
                  class="min-w-0 flex-1 truncate"
                  use:truncatedTitle={friendlySummary}
                  aria-hidden="true">{friendlySummary}</span
                >
              {/if}
              <span
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
                data-testid="event-wakeup-chevron-column"
              >
                <Fa
                  icon={faChevronDown}
                  size={16}
                  class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {detailsOpen &&
                  !onPinnedActivate
                    ? ''
                    : 'rotate-90'}"
                />
              </span>
            </Button>
          </div>

          {#if detailsOpen && !onPinnedActivate}
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
                            <span class="type-body font-normal text-muted-foreground">
                              {agentStatusLabel(event.type)}
                            </span>
                          {:else}
                            <span class="type-caption font-medium text-primary-ink"
                              >{event.label}</span
                            >
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
    class="event-wakeup-banner type-body mb-1 flex items-center gap-1.5 py-0.5 pr-2 pl-0 text-primary-ink"
    transition:safeDisclosureTransition={{ tier: 'moderate' }}
  >
    <Fa icon={faRotate} class="h-2 w-2 opacity-40" />
    <span>{friendlySummary}</span>
  </div>
{/if}

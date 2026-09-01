<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import AgentSubscriptions from './AgentSubscriptions.svelte';
  import BackgroundHooksRow from './BackgroundHooksRow.svelte';
  import BrowserTabsRow from './BrowserTabsRow.svelte';
  import MonitoredPrsRow from './MonitoredPrsRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import { faBell, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
  } from './subscription-disclosure';
  import { Button } from '$lib/components/ui/button';
  import {
    getEventSubscriptionsExpanded,
    setEventSubscriptionsExpanded,
  } from './agent-subscriptions-view-state';
  import { safeSubscriptionSlide } from './subscription-disclosure';
  import type { TaskProgressItem } from './workspace-task-fallback';

  interface Props {
    workspaceId: string;
    agentId: string;
    compact?: boolean;
    visible?: boolean;
    /** Static, daemon-free content used by catalog and visual-test previews. */
    isolatedPreview?: {
      count: number;
      initiallyExpanded?: boolean;
      mode?: 'generic' | 'agents' | 'mixed';
      agents?: Array<{
        id: string;
        name: string;
        finished?: boolean;
        taskProgress?: TaskProgressItem[];
      }>;
    };
    previewContent?: Snippet;
  }

  let {
    workspaceId,
    agentId,
    compact = false,
    visible = $bindable(false),
    isolatedPreview,
    previewContent,
  }: Props = $props();
  let agentsVisible = $state(false);
  let hooksVisible = $state(false);
  let prsVisible = $state(false);
  let browserTabsVisible = $state(false);
  let agentCount = $state(0);
  let hookCount = $state(0);
  let prCount = $state(0);
  let browserTabCount = $state(0);
  let participantAgentIds = $state<string[]>([]);
  let participantAvatarItems = $state<AgentAvatarStackItem[]>([]);
  let isCollapsed = $state(false);
  let desiredCollapsed = $state(false);
  let bodyIsClosing = $state(false);
  let disclosureKey = $state('');
  let bodyElement: HTMLElement | undefined = $state();
  const componentId = $props.id();
  const bodyId = `event-subscriptions-body-${componentId}`;
  const hasEventSubscriptions = $derived(
    isolatedPreview ? isolatedPreview.count > 0 : agentsVisible || hooksVisible || prsVisible,
  );
  const hasSubscriptions = $derived(hasEventSubscriptions || browserTabsVisible);
  const totalCount = $derived(
    isolatedPreview ? isolatedPreview.count : agentCount + hookCount + prCount,
  );

  // Agent-only cards show "Waiting for N agents"; mixed/non-agent cards show "Subscribed to N events"
  const isAgentOnly = $derived(
    isolatedPreview?.mode === 'agents' ||
      (!isolatedPreview && agentsVisible && !hooksVisible && !prsVisible),
  );
  const agentOnlyCount = $derived(
    isolatedPreview?.mode === 'agents' ? (isolatedPreview.agents?.length ?? 0) : agentCount,
  );
  const collapsedStackItems = $derived(participantAvatarItems);

  const heading = $derived.by(() => {
    if (isolatedPreview && !isAgentOnly) {
      // Preview mode: use generic subscribed language
      return totalCount === 0
        ? m.events_ipc_subscribed_description()
        : totalCount === 1
          ? m.chat_eventSubscriptions_heading_one({ count: formatInteger(totalCount) })
          : m.chat_eventSubscriptions_heading_many({ count: formatInteger(totalCount) });
    }

    if (isAgentOnly) {
      // Agent-only: "Waiting for N agents"
      return agentOnlyCount === 1
        ? m.chat_agentSubscriptions_waitingForAgents_one({ count: formatInteger(agentOnlyCount) })
        : m.chat_agentSubscriptions_waitingForAgents_many({ count: formatInteger(agentOnlyCount) });
    }

    // Mixed or non-agent: "Subscribed to N events"
    return totalCount === 0
      ? m.events_ipc_subscribed_description()
      : totalCount === 1
        ? m.chat_eventSubscriptions_heading_one({ count: formatInteger(totalCount) })
        : m.chat_eventSubscriptions_heading_many({ count: formatInteger(totalCount) });
  });

  // A tabs-only card has no event subscriptions, so labelling it "Subscribed
  // to events" would be wrong — use the browser-tabs heading instead.
  const cardAriaLabel = $derived(
    hasEventSubscriptions || !browserTabsVisible
      ? heading
      : m.chat_browserTabs_heading({ count: formatInteger(browserTabCount) }),
  );

  $effect(() => {
    visible = hasSubscriptions;
  });

  $effect(() => {
    const nextKey = `${workspaceId}:${agentId}:${isolatedPreview?.count ?? 'live'}`;
    if (nextKey === disclosureKey) return;
    disclosureKey = nextKey;
    isCollapsed = isolatedPreview
      ? !(isolatedPreview.initiallyExpanded ?? true)
      : !getEventSubscriptionsExpanded(workspaceId, agentId);
    desiredCollapsed = isCollapsed;
    bodyIsClosing = false;
  });

  async function toggleCollapsed(event?: MouseEvent) {
    const nextCollapsed = !desiredCollapsed;
    desiredCollapsed = nextCollapsed;
    if (nextCollapsed && bodyElement?.contains(document.activeElement)) {
      (event?.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
    }
    if (nextCollapsed) {
      bodyIsClosing = true;
      await tick();
      if (!desiredCollapsed) return;
      isCollapsed = true;
    } else {
      isCollapsed = false;
      bodyIsClosing = false;
    }
    if (!isolatedPreview) setEventSubscriptionsExpanded(workspaceId, agentId, !nextCollapsed);
  }
</script>

<div
  class="w-full min-w-0 max-w-full {compact ? 'mt-6' : 'mt-8'}"
  class:hidden={!hasSubscriptions}
  data-testid="subscription-utility-area"
  data-has-subscriptions={hasSubscriptions}
>
  <section
    class="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/80 shadow-sm font-family-child"
    data-conversation-layer="event-subscriptions"
    data-testid="event-subscriptions-card"
    aria-label={cardAriaLabel}
  >
    {#if !isAgentOnly && hasEventSubscriptions}
      <h2 data-testid="event-subscriptions-outer-header">
        <Button
          variant="plain"
          type="button"
          class="shrink whitespace-normal rounded-none border-0 text-left {SUBSCRIPTION_DISCLOSURE_ROW_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-2 focus-visible:ring-inset"
          data-testid="event-subscriptions-summary"
          data-subscription-row="grouped-summary"
          aria-expanded={!desiredCollapsed}
          aria-controls={bodyId}
          onclick={toggleCollapsed}
        >
          <span class="w-max shrink-0 {SUBSCRIPTION_LEADING_CONTENT_CLASS}">
            <span
              class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
              data-testid="event-subscriptions-leading-column"
              aria-hidden="true"
            >
              <Fa
                icon={faBell}
                size={14}
                class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
              />
            </span>
            <span
              class="whitespace-nowrap text-muted-foreground"
              data-testid="event-subscriptions-summary-title"
            >
              {heading}
            </span>
          </span>
          {#if isCollapsed && collapsedStackItems.length > 0}
            <AgentAvatarStack items={collapsedStackItems} maxVisible={8} adaptive />
          {:else}
            <span class="min-w-0 flex-1" aria-hidden="true"></span>
          {/if}
          <span
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
            data-testid="event-subscriptions-chevron"
          >
            <Fa
              icon={faChevronDown}
              size={16}
              class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {desiredCollapsed
                ? 'rotate-90'
                : ''}"
            />
          </span>
        </Button>
      </h2>
    {/if}
    {#if isAgentOnly || !isCollapsed}
      <div
        bind:this={bodyElement}
        id={bodyId}
        data-testid="event-subscriptions-body"
        data-subscription-motion="height-opacity-y"
        inert={!isAgentOnly && bodyIsClosing}
        aria-hidden={!isAgentOnly && bodyIsClosing}
        transition:safeSubscriptionSlide
      >
        {#if isolatedPreview?.mode === 'agents' || isolatedPreview?.mode === 'mixed'}
          <div
            class={isAgentOnly ? '' : 'border-t border-border'}
            data-testid="event-subscriptions-agents"
          >
            <AgentSubscriptions
              {workspaceId}
              {agentId}
              {compact}
              embedded
              forceWaitingHeader
              isolatedPreview={{
                agents: isolatedPreview.agents ?? [],
                initiallyExpanded: isolatedPreview.initiallyExpanded ?? true,
              }}
              bind:participantAgentIds
              bind:participantAvatarItems
            />
          </div>
          {#if isolatedPreview.mode === 'mixed'}
            <div class="border-t border-border" data-testid="event-subscriptions-preview">
              {@render previewContent?.()}
            </div>
          {/if}
        {:else if isolatedPreview}
          <div class="border-t border-border" data-testid="event-subscriptions-preview">
            {@render previewContent?.()}
          </div>
        {:else}
          <div
            class={isAgentOnly ? '' : 'border-t border-border'}
            class:hidden={!agentsVisible}
            data-testid="event-subscriptions-agents"
          >
            <AgentSubscriptions
              {workspaceId}
              {agentId}
              {compact}
              embedded
              forceWaitingHeader
              bind:visible={agentsVisible}
              bind:count={agentCount}
              bind:participantAgentIds
              bind:participantAvatarItems
            />
          </div>
          <div
            class="border-t border-border"
            class:hidden={!hooksVisible}
            data-testid="event-subscriptions-hooks"
          >
            <BackgroundHooksRow
              {workspaceId}
              {agentId}
              embedded
              bind:visible={hooksVisible}
              bind:count={hookCount}
            />
          </div>
          <div
            class="border-t border-border"
            class:hidden={!prsVisible}
            data-testid="event-subscriptions-prs"
          >
            <MonitoredPrsRow
              {workspaceId}
              {agentId}
              embedded
              bind:visible={prsVisible}
              bind:count={prCount}
            />
          </div>
        {/if}
      </div>
    {/if}
    {#if !isolatedPreview}
      <!-- Parallel "Browser tabs (N)" section: stays visible while the events
           disclosure above is collapsed (it has its own expand state). -->
      <div
        class={hasEventSubscriptions ? 'border-t border-border' : ''}
        class:hidden={!browserTabsVisible}
        data-testid="event-subscriptions-browser-tabs"
      >
        <BrowserTabsRow
          {workspaceId}
          {agentId}
          embedded
          bind:visible={browserTabsVisible}
          bind:count={browserTabCount}
        />
      </div>
    {/if}
  </section>
</div>

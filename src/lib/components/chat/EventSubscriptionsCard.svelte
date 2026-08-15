<script lang="ts">
  import AgentSubscriptions from './AgentSubscriptions.svelte';
  import BackgroundHooksRow from './BackgroundHooksRow.svelte';
  import MonitoredPrsRow from './MonitoredPrsRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';
  import { Button } from '$lib/components/ui/button';
  import {
    getEventSubscriptionsExpanded,
    setEventSubscriptionsExpanded,
  } from './agent-subscriptions-view-state';

  interface Props {
    workspaceId: string;
    agentId: string;
    compact?: boolean;
    visible?: boolean;
  }

  let { workspaceId, agentId, compact = false, visible = $bindable(false) }: Props = $props();
  let agentsVisible = $state(false);
  let hooksVisible = $state(false);
  let prsVisible = $state(false);
  let agentCount = $state(0);
  let hookCount = $state(0);
  let prCount = $state(0);
  let isCollapsed = $state(true);
  let disclosureKey = $state('');
  const componentId = $props.id();
  const bodyId = `event-subscriptions-body-${componentId}`;
  const hasSubscriptions = $derived(agentsVisible || hooksVisible || prsVisible);
  const totalCount = $derived(agentCount + hookCount + prCount);
  const heading = $derived(
    totalCount === 0
      ? m.events_ipc_subscribed_description()
      : totalCount === 1
        ? m.chat_eventSubscriptions_heading_one({ count: formatInteger(totalCount) })
        : m.chat_eventSubscriptions_heading_many({ count: formatInteger(totalCount) }),
  );

  $effect(() => {
    visible = hasSubscriptions;
  });

  $effect(() => {
    const nextKey = `${workspaceId}:${agentId}`;
    if (nextKey === disclosureKey) return;
    disclosureKey = nextKey;
    isCollapsed = !getEventSubscriptionsExpanded(workspaceId, agentId);
  });

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
    setEventSubscriptionsExpanded(workspaceId, agentId, !isCollapsed);
  }

  function handleToggleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleCollapsed();
  }
</script>

<div
  class="w-full min-w-0 max-w-full {compact ? 'mt-6' : 'mt-8'}"
  class:hidden={!hasSubscriptions}
  data-testid="subscription-utility-area"
  data-has-subscriptions={hasSubscriptions}
>
  <section
    class="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border/60 bg-card/80 shadow-sm font-family-child"
    data-conversation-layer="event-subscriptions"
    data-testid="event-subscriptions-card"
    aria-label={heading}
  >
    <h2>
      <Button
        variant="plain"
        type="button"
        class="h-auto min-h-0 w-full shrink whitespace-normal rounded-none border-0 px-3! py-2! text-left {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-2 focus-visible:ring-inset"
        data-testid="event-subscriptions-summary"
        data-subscription-row="grouped-summary"
        aria-expanded={!isCollapsed}
        aria-controls={bodyId}
        onclick={toggleCollapsed}
        onkeydown={handleToggleKeydown}
      >
        <span class="min-w-0 flex-1 truncate">{heading}</span>
        <span
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
          data-testid="event-subscriptions-chevron"
        >
          <Fa
            icon={faChevronDown}
            class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {isCollapsed
              ? 'rotate-90'
              : ''}"
          />
        </span>
      </Button>
    </h2>
    <div
      id={bodyId}
      class:hidden={isCollapsed}
      data-testid="event-subscriptions-body"
      aria-hidden={isCollapsed}
    >
      <div
        class="border-t border-border/40"
        class:hidden={!agentsVisible}
        data-testid="event-subscriptions-agents"
      >
        <AgentSubscriptions
          {workspaceId}
          {agentId}
          {compact}
          embedded
          bind:visible={agentsVisible}
          bind:count={agentCount}
        />
      </div>
      <div
        class="border-t border-border/40"
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
        class="border-t border-border/40"
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
    </div>
  </section>
</div>

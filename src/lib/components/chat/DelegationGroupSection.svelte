<script lang="ts">
  /**
   * DelegationGroupSection Component
   *
   * One collapsible footer section per `after_all` delegation group: a header
   * with a (done/total) counter (or a delivery-pending warning when the group
   * finished but its aggregated wake has not been delivered), group-scoped
   * stop/cancel actions, an avatar strip when collapsed, and the group's
   * agent cards when expanded.
   */
  import { fade } from 'svelte/transition';
  import { safeSlide } from '$lib/utils/animations';
  import { flip } from 'svelte/animate';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    faChevronDown,
    faHourglass,
    faStop,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import AgentCard from './AgentCard.svelte';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import {
    groupDoneCount,
    isGroupDeliveryPending,
    sortWorkingAgentsFirst,
    uniqueAgentIds,
  } from './delegation-ordering';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { Workspace } from '$shared/types';
  import type { DelegationGroupStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types';
  import {
    safeSubscriptionSlide,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';

  interface Props {
    group: DelegationGroupStatus;
    workspace?: Workspace | null;
    /** Hide the group-scoped stop/cancel buttons (e.g. transitional states) */
    hideActions?: boolean;
    onStopGroup?: (group: DelegationGroupStatus) => void;
    onCancelGroup?: (group: DelegationGroupStatus) => void;
  }

  let {
    group,
    workspace = null,
    hideActions = false,
    onStopGroup,
    onCancelGroup,
  }: Props = $props();

  let isCollapsed: boolean = $state(true);

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
  }

  const completedAgentIdSet = $derived(
    new Set([...group.completedAgentIds, ...group.deletedAgentIds]),
  );
  const orderedAgentIds = $derived(
    sortWorkingAgentsFirst(group.expectedAgentIds, completedAgentIdSet),
  );
  const orderedAgentStackItems = $derived(
    orderedAgentIds.map((agentId): AgentAvatarStackItem => ({ key: agentId, agentId })),
  );
  const doneCount = $derived(groupDoneCount(group));
  const totalCount = $derived(uniqueAgentIds(group.expectedAgentIds).length);
  const remainingCount = $derived(Math.max(0, totalCount - doneCount));
  const deliveryPending = $derived(isGroupDeliveryPending(group));
  const agentListId = $derived(`delegation-group-agent-list-${group.groupId}`);

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    toggleCollapsed();
  }
</script>

<div
  class="w-full min-w-0 max-w-full overflow-hidden font-family-child"
  data-testid="delegation-group-section"
>
  <div
    class="{SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    data-testid="delegation-group-header"
  >
    <button
      type="button"
      class="{SUBSCRIPTION_LEADING_CONTENT_CLASS} flex-1 cursor-pointer rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="group-summary-toggle"
      aria-expanded={!isCollapsed}
      aria-controls={agentListId}
      onclick={toggleCollapsed}
      onkeydown={handleDisclosureKeydown}
    >
      {#if deliveryPending}
        <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS}>
          <Fa icon={faTriangleExclamation} size={14} class="h-3.5! w-3.5! text-warning" />
        </span>
        <span class="min-w-0 truncate whitespace-nowrap" data-testid="group-delivery-pending">
          {m.chat_agentSubscriptions_deliveryPending_label()}
        </span>
      {:else}
        <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS}>
          <Fa icon={faHourglass} size={14} class="h-3.5! w-3.5! {SUBSCRIPTION_ICON_CLASS}" />
        </span>
        <span class="min-w-0 truncate whitespace-nowrap" data-testid="group-summary-title">
          {remainingCount === 0
            ? m.chat_agentSubscriptions_allFinished_label()
            : remainingCount === 1
              ? m.chat_agentSubscriptions_waitingForAgents_one({
                  count: formatInteger(remainingCount),
                })
              : m.chat_agentSubscriptions_waitingForAgents_many({
                  count: formatInteger(remainingCount),
                })}
        </span>
      {/if}
    </button>

    <!-- Inline agent avatars when collapsed -->
    {#if isCollapsed}
      <div
        class="min-w-0 shrink overflow-hidden"
        data-testid="group-avatar-strip"
        transition:fade={{ duration: 150 }}
      >
        {#snippet delegationAvatar(item: AgentAvatarStackItem)}
          <InlineAgentAvatar
            agentId={item.agentId}
            {workspace}
            isCompleted={completedAgentIdSet.has(item.agentId)}
          />
        {/snippet}
        <AgentAvatarStack
          items={orderedAgentStackItems}
          maxVisible={5}
          adaptive
          interactive
          variant="standard"
          itemContent={delegationAvatar}
        />
      </div>
    {/if}

    <div class="flex shrink-0 items-center gap-0.5" data-testid="group-header-actions">
      {#if !hideActions}
        <!-- Provider ensures proper context and cleanup during component destruction -->
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger>
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={(event) => {
                  event.stopPropagation();
                  onStopGroup?.(group);
                }}
                class="h-6 w-6 text-ghost opacity-60 hover:text-muted-foreground/70 hover:opacity-100 focus-visible:opacity-100"
                data-testid="group-stop"
                aria-label={m.chat_agentSubscriptions_stopGroup_tooltip()}
              >
                <Fa icon={faStop} class="h-3.5! w-3.5!" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>{m.chat_agentSubscriptions_stopGroup_tooltip()}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <!-- Provider ensures proper context and cleanup during component destruction -->
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger>
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={(event) => {
                  event.stopPropagation();
                  onCancelGroup?.(group);
                }}
                class="h-6 w-6 text-ghost opacity-60 hover:text-muted-foreground/70 hover:opacity-100 focus-visible:opacity-100"
                data-testid="group-cancel"
                aria-label={m.chat_agentSubscriptions_cancelGroup_tooltip()}
              >
                <Fa icon={faXmark} class="h-3.5! w-3.5!" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>{m.chat_agentSubscriptions_cancelGroup_tooltip()}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}
    </div>
    <button
      type="button"
      class="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-ghost transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="group-collapse-toggle"
      aria-expanded={!isCollapsed}
      aria-controls={agentListId}
      aria-label={isCollapsed
        ? m.chat_agentSubscriptions_expandWatches_ariaLabel()
        : m.chat_agentSubscriptions_collapseWatches_ariaLabel()}
      onclick={toggleCollapsed}
      onkeydown={handleDisclosureKeydown}
    >
      <span class="inline-flex" data-testid="group-chevron">
        <Fa
          icon={faChevronDown}
          size={16}
          class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {isCollapsed
            ? 'rotate-90'
            : ''}"
        />
      </span>
    </button>
  </div>

  <!-- Agent cards - shown when expanded -->
  {#if !isCollapsed}
    <div
      id={agentListId}
      class="flex w-full min-w-0 max-w-full flex-col gap-0.5 overflow-hidden border-t border-border pt-1.5 pr-2 pb-0.5 pl-4.5 font-family-child"
      data-testid="delegation-group-agent-list"
      transition:safeSubscriptionSlide
    >
      {#each orderedAgentIds.slice(0, 5) as agentId (agentId)}
        <div
          class="w-full min-w-0 max-w-full overflow-hidden border-t border-border pt-0.5 first:border-t-0 first:pt-0"
          animate:flip={{ duration: 200 }}
          transition:safeSlide={{ axis: 'y', duration: 200 }}
        >
          <AgentCard
            {agentId}
            {workspace}
            isCompleted={completedAgentIdSet.has(agentId)}
            inline
            hidePreview
          />
        </div>
      {/each}
      {#if orderedAgentIds.length > 5}
        <div class="text-ui text-subtle text-center py-1">
          {m.chat_shared_moreAgents_label({ count: formatInteger(orderedAgentIds.length - 5) })}
        </div>
      {/if}
    </div>
  {/if}
</div>

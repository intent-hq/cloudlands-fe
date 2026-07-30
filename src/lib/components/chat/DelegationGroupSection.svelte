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
  import { fade, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    faChevronDown,
    faChevronRight,
    faHourglass,
    faStop,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import AgentCard from './AgentCard.svelte';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import {
    groupDoneCount,
    isGroupDeliveryPending,
    sortWorkingAgentsFirst,
  } from './delegation-ordering';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { Workspace } from '$shared/types';
  import type { DelegationGroupStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types';

  interface Props {
    group: DelegationGroupStatus;
    workspace?: Workspace | null;
    /** Hide the group-scoped stop/cancel buttons (e.g. transitional states) */
    hideActions?: boolean;
    onStopGroup?: (group: DelegationGroupStatus) => void;
    onCancelGroup?: (group: DelegationGroupStatus) => void;
  }

  let { group, workspace = null, hideActions = false, onStopGroup, onCancelGroup }: Props = $props();

  let isCollapsed: boolean = $state(false);

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
  }

  const completedAgentIdSet = $derived(
    new Set([...group.completedAgentIds, ...group.deletedAgentIds]),
  );
  const orderedAgentIds = $derived(
    sortWorkingAgentsFirst(group.expectedAgentIds, completedAgentIdSet),
  );
  const doneCount = $derived(groupDoneCount(group));
  const totalCount = $derived(group.expectedAgentIds.length);
  const deliveryPending = $derived(isGroupDeliveryPending(group));
</script>

<div class="w-full font-family-child" data-testid="delegation-group-section">
  <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-subtle">
    <!-- Collapse/expand toggle -->
    <button
      type="button"
      class="shrink-0 flex items-center gap-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
      onclick={toggleCollapsed}
    >
      <Fa icon={isCollapsed ? faChevronRight : faChevronDown} class="w-2.5! h-2.5!" />
    </button>

    <!-- Group status label with (done/total) counter -->
    <button
      type="button"
      class="shrink-0 flex items-center gap-2 whitespace-nowrap cursor-pointer hover:text-muted-foreground transition-colors"
      onclick={toggleCollapsed}
    >
      {#if deliveryPending}
        <Fa icon={faTriangleExclamation} size="13" class="text-warning" />
        <span class="text-warning" data-testid="group-delivery-pending">
          {m.chat_agentSubscriptions_deliveryPending_label()}
        </span>
      {:else}
        <Fa icon={faHourglass} size="13" />
        {m.chat_agentSubscriptions_waitingForAll_label()}
      {/if}
      {#if totalCount > 0}
        <span class="text-subtle" data-testid="group-counter">
          ({formatInteger(doneCount)}/{formatInteger(totalCount)})
        </span>
      {/if}
    </button>

    <!-- Inline agent avatars when collapsed -->
    {#if isCollapsed}
      <div class="flex items-center -space-x-1.5" transition:fade={{ duration: 150 }}>
        {#each orderedAgentIds.slice(0, 5) as agentId (agentId)}
          <div animate:flip={{ duration: 200 }}>
            <InlineAgentAvatar
              {agentId}
              {workspace}
              isCompleted={completedAgentIdSet.has(agentId)}
            />
          </div>
        {/each}
        {#if orderedAgentIds.length > 5}
          <span class="text-ui text-subtle pl-2">
            +{orderedAgentIds.length - 5}
          </span>
        {/if}
      </div>
    {/if}

    <div class="flex-1"></div>
    {#if !hideActions}
      <!-- Provider ensures proper context and cleanup during component destruction -->
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger>
            <Button
              variant="ghost-light"
              size="icon-xs"
              onclick={() => onStopGroup?.(group)}
              class="text-ghost hover:text-muted-foreground/70"
              data-testid="group-stop"
              aria-label={m.chat_agentSubscriptions_stopGroup_tooltip()}
            >
              <Fa icon={faStop} class="w-2.5! h-2.5!" />
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
              onclick={() => onCancelGroup?.(group)}
              class="text-ghost hover:text-muted-foreground/70"
              data-testid="group-cancel"
              aria-label={m.chat_agentSubscriptions_cancelGroup_tooltip()}
            >
              <Fa icon={faXmark} class="w-2.5! h-2.5!" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side="top" class="text-xs">
            <p>{m.chat_agentSubscriptions_cancelGroup_tooltip()}</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {/if}
  </div>

  <!-- Agent cards - shown when expanded -->
  {#if !isCollapsed}
    <div
      class="flex flex-col gap-0.5 w-full pl-4.5 pr-2 font-family-child"
      transition:slide={{ duration: 150 }}
    >
      {#each orderedAgentIds.slice(0, 5) as agentId (agentId)}
        <div
          class="w-full"
          animate:flip={{ duration: 200 }}
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          <AgentCard {agentId} {workspace} isCompleted={completedAgentIdSet.has(agentId)} />
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

<script lang="ts">
  /**
   * AgentSubscriptions Component
   *
   * Shows what events an agent is currently subscribed to as a sleek bottom row.
   * Also shows a brief "Woken up" indicator when an agent is woken by a subscription.
   *
   * All subscription data comes from Redux selectors (populated by the
   * agent-subscription-ui saga). No IPC listeners, polling, or timers in this component.
   */
  import { fade, slide } from 'svelte/transition';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    faHourglass,
    faBell,
    faXmark,
    faChevronDown,
    faChevronRight,
    faStop,
    faTriangleExclamation,
    faCircleCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createLogger } from '$lib/utils/client-logger';
  import { invoke } from '$lib/electron-bridge';
  import Button from '$lib/components/ui/button/button.svelte';
  import { writable } from 'svelte/store';
  import AgentCard from './AgentCard.svelte';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import { agentService } from '$features/agent/agent-ipc-bridge';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
    selectAgentSubscriptions,
    selectDelegationGroups,
    selectWokenUpInfo,
    selectCompletionStatus,
    selectWaitingState,
  } from '$lib/store/slices/agent-subscription-ui/agent-subscription-ui-selectors';
  import { resetSubscriptionUI } from '$lib/store/slices/agent-subscription-ui/agent-subscription-ui-slice';

  const logger = createLogger('AgentSubscriptions');

  interface Props {
    workspaceId: string;
    agentId: string;
  }

  let { workspaceId, agentId }: Props = $props();

  // ── Redux selectors (called at component init time) ──────────────────
  const dispatch = getDispatch();

  // Writable stores mirror prop values so Redux selectors re-evaluate
  // when workspaceId or agentId changes.
  const workspaceIdStore = writable(workspaceId);
  const agentIdStore = writable(agentId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const workspaceById = selectWorkspaceById(workspaceIdStore);
  const resolvedWorkspace = $derived($workspaceById ?? null);

  const subs$ = selectAgentSubscriptions(workspaceIdStore, agentIdStore);
  const groups$ = selectDelegationGroups(workspaceIdStore, agentIdStore);
  const wokenUpInfo$ = selectWokenUpInfo(workspaceIdStore, agentIdStore);
  const completionStatus$ = selectCompletionStatus(workspaceIdStore, agentIdStore);
  const waitingState$ = selectWaitingState(workspaceIdStore, agentIdStore);

  // ── Component-local UI state ─────────────────────────────────────────
  let isCollapsed: boolean = $state(false);

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
  }

  // ── Derived display values ───────────────────────────────────────────

  // Agent IDs from delegation groups (authoritative for "Waiting for all")
  const delegationWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const group of $groups$) {
      if (group.awaitMode === 'all') {
        for (const id of group.expectedAgentIds) ids.add(id);
      }
    }
    return Array.from(ids);
  });

  // Agent IDs from non-delegation subscriptions
  const otherWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const sub of $subs$) {
      if (sub.delegationGroup?.awaitMode === 'all') continue;
      for (const actorId of sub.actorIds || []) ids.add(actorId);
    }
    return Array.from(ids);
  });

  const watchedAgentIds = $derived.by(() => {
    return Array.from(new Set([...delegationWatchedIds, ...otherWatchedIds]));
  });

  const waitMode = $derived.by(() => {
    for (const group of $groups$) {
      if (group.awaitMode === 'all') return 'all';
    }
    for (const sub of $subs$) {
      if (sub.delegationGroup?.awaitMode === 'all') return 'all';
    }
    return 'any';
  });

  // Whether any delegation group completed all agents but has not been delivered yet
  const hasUndeliveredCompleteGroup = $derived.by(() => {
    return $groups$.some((g) => {
      const doneCount = g.completedAgentIds.length + g.deletedAgentIds.length;
      return doneCount >= g.expectedAgentIds.length && g.expectedAgentIds.length > 0 && !g.delivered;
    });
  });

  const isCompleted = $derived($waitingState$ === 'completed');

  const showSubscriptionRow = $derived.by(() => {
    // Show row during the 'completed' transitional state
    if (isCompleted) return true;
    const hasActive = $subs$.length > 0 || $groups$.length > 0;
    const cs = $completionStatus$;
    // Show row when all agents completed but group not yet delivered (stuck state)
    if (hasActive && waitMode === 'all' && hasUndeliveredCompleteGroup) return true;
    return (
      hasActive &&
      watchedAgentIds.length > 0 &&
      !(waitMode === 'all' && $groups$.length === 0) &&
      !(waitMode === 'all' && cs.total > 0 && cs.completed >= cs.total)
    );
  });

  // ── Button handlers ──────────────────────────────────────────────────

  async function cancelSubscriptions() {
    if (!workspaceId || !agentId) return;
    try {
      await invoke('events:unsubscribe-agent', { workspaceId, agentId });
    } catch (error) {
      logger.error('Failed to cancel subscriptions', { error });
    }
    dispatch(resetSubscriptionUI(workspaceId, agentId));
  }

  async function stopAllAgents() {
    if (!workspaceId || !agentId) return;
    try {
      const agentIdsToStop = [...watchedAgentIds];
      await invoke('events:unsubscribe-agent', { workspaceId, agentId });
      dispatch(resetSubscriptionUI(workspaceId, agentId));
      await agentService.stopSession(agentId);
      await Promise.all(agentIdsToStop.map((id) => agentService.stopSession(id)));
    } catch (error) {
      logger.error('Failed to stop all agents', { error });
    }
  }
</script>

{#if $wokenUpInfo$ && !showSubscriptionRow}
  <!-- Standalone woken-up indicator: shown only when no subscription row is active -->
  <div
    class="flex items-end gap-2 px-4.5 py-1.5 text-ui text-subtle font-family-child"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root delayDuration={0}>
        <Tooltip.Trigger>
          <div class="shrink-0 flex items-center pb-1 gap-2 text-subtle">
            <Fa icon={faBell} size="xs" />
            <span>Woken up</span>
            <span class="text-subtle">
              ({$wokenUpInfo$.eventCount}
              {$wokenUpInfo$.eventCount === 1 ? 'event' : 'events'})
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" class="text-xs">
          <p>Agent was woken by subscription events:</p>
          <ul class="mt-1 text-subtle">
            {#each $wokenUpInfo$.eventTypes as eventType, i (`eventType-${i}-${eventType}`)}
              <li>• {eventType}</li>
            {/each}
          </ul>
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  </div>
{/if}

{#if showSubscriptionRow}
  <div class="w-full font-family-child">
    <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-subtle">
      <!-- Collapse/expand toggle with wait mode indicator -->
      <button
        type="button"
        class="shrink-0 flex items-center gap-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
        onclick={toggleCollapsed}
      >
        <Fa icon={isCollapsed ? faChevronRight : faChevronDown} class="w-2.5! h-2.5!" />
      </button>

      <!-- Wait mode indicator - clickable to toggle collapse/expand -->
      {#if isCompleted}
        <span
          class="shrink-0 flex items-center gap-2 whitespace-nowrap text-green-500"
          transition:fade={{ duration: 200 }}
        >
          <Fa icon={faCircleCheck} size="13" />
          Completed
        </span>
      {:else if waitMode === 'all'}
        <button
          type="button"
          class="shrink-0 flex items-center gap-2 whitespace-nowrap cursor-pointer hover:text-muted-foreground transition-colors"
          onclick={toggleCollapsed}
        >
          {#if hasUndeliveredCompleteGroup}
            <Fa icon={faTriangleExclamation} size="13" class="text-warning" />
            <span class="text-warning">Delivery pending</span>
          {:else}
            <Fa icon={faHourglass} size="13" />
            Waiting for all
          {/if}
          {#if $completionStatus$.total > 0}
            <span class="text-subtle">
              ({$completionStatus$.completed}/{$completionStatus$.total})
            </span>
          {/if}
        </button>
      {:else}
        <button
          type="button"
          class="shrink-0 cursor-pointer hover:text-muted-foreground transition-colors"
          onclick={toggleCollapsed}
        >
          Waiting for {watchedAgentIds.length} agent{watchedAgentIds.length === 1 ? '' : 's'}
        </button>
      {/if}

      <!-- Inline "Woken up" pill inside the subscription row -->
      {#if $wokenUpInfo$}
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger>
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-ui text-subtle bg-muted/50"
                transition:fade={{ duration: 200 }}
              >
                <Fa icon={faBell} size="xs" />
                Woken up
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>
                Agent was woken by {$wokenUpInfo$.eventCount}
                {$wokenUpInfo$.eventCount === 1 ? 'event' : 'events'}:
              </p>
              <ul class="mt-1 text-subtle">
                {#each $wokenUpInfo$.eventTypes as eventType, i (`eventType-${i}-${eventType}`)}
                  <li>• {eventType}</li>
                {/each}
              </ul>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}

      <!-- Inline agent avatars when collapsed -->
      {#if isCollapsed}
        <div class="flex items-center -space-x-1.5">
          {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
            <InlineAgentAvatar agentId={watchedAgentId} workspace={resolvedWorkspace} />
          {/each}
          {#if watchedAgentIds.length > 5}
            <span class="text-ui text-subtle pl-2">
              +{watchedAgentIds.length - 5}
            </span>
          {/if}
        </div>
      {/if}

      <!-- Action buttons (hidden during completed state — nothing to cancel) -->
      <div class="flex-1"></div>
      {#if !isCompleted}
        <!-- Provider ensures proper context and cleanup during component destruction -->
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger>
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={stopAllAgents}
                class="text-ghost hover:text-muted-foreground/70"
              >
                <Fa icon={faStop} class="w-2.5! h-2.5!" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>Stop all agents</p>
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
                onclick={cancelSubscriptions}
                class="text-ghost hover:text-muted-foreground/70"
              >
                <Fa icon={faXmark} class="w-2.5! h-2.5!" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>Cancel subscription</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}
    </div>
  </div>

  <!-- Agent cards with streaming last message - shown when expanded -->
  {#if !isCollapsed}
    <div
      class="flex flex-col gap-0.5 w-full pl-4.5 pr-2 font-family-child"
      transition:slide={{ duration: 150 }}
    >
      {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
        <div class="w-full" transition:slide={{ axis: 'y', duration: 200 }}>
          <AgentCard agentId={watchedAgentId} workspace={resolvedWorkspace} />
        </div>
      {/each}
      {#if watchedAgentIds.length > 5}
        <div class="text-ui text-subtle text-center py-1">
          +{watchedAgentIds.length - 5} more agents
        </div>
      {/if}
    </div>
  {/if}
{/if}

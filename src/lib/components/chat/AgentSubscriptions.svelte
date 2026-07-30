<script lang="ts">
  /**
   * AgentSubscriptions Component
   *
   * Footer for what an agent is currently waiting on: one-shot watch rows on
   * top (individual AgentCards with per-row actions, no group chrome),
   * followed by one collapsible DelegationGroupSection per `after_all`
   * delegation group. Also shows a brief "Woken up" indicator when an agent
   * is woken by a subscription.
   *
   * All subscription data comes from Redux selectors (populated by the
   * agent-subscription-ui read middleware). No IPC listeners, polling, or
   * timers in this component.
   */
  import {
  fade,
  slide,
} from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
  faBell,
  faXmark,
  faStop,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createLogger } from '$lib/utils/client-logger';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import AgentCard from './AgentCard.svelte';
  import DelegationGroupSection from './DelegationGroupSection.svelte';
  import { isGroupDeliveryPending } from './delegation-ordering';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  import {
  selectAgentSubscriptions,
  selectDelegationGroups,
  selectWokenUpInfo,
  selectCompletionStatus,
  selectWaitingState,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
  import {
  cancelAgentSubscriptionsRequested,
  requestSubscriptionFetch,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import { stopAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import type { DelegationGroupStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('AgentSubscriptions');

  interface Props {
    workspaceId: string;
    agentId: string;
  }

  let { workspaceId, agentId }: Props = $props();

  // ── Redux selectors (called at component init time) ──────────────────

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

  // Request an initial fetch of subscription data so the UI is populated
  // even if no IPC events have arrived yet (e.g. switching to an agent
  // that is already waiting on delegated agents).
  let lastFetchKey: string | null = null;
  $effect(() => {
    if (!workspaceId || !agentId) return;
    const nextKey = `${workspaceId}::${agentId}`;
    if (nextKey === lastFetchKey) return;
    lastFetchKey = nextKey;
    untrack(() => appStore.dispatch(requestSubscriptionFetch(workspaceId, agentId)));
  });

  const workspaceById = selectWorkspaceById(workspaceIdStore);
  const resolvedWorkspace = $derived($workspaceById ?? null);

  const subs$ = selectAgentSubscriptions(workspaceIdStore, agentIdStore);
  const groups$ = selectDelegationGroups(workspaceIdStore, agentIdStore);
  const wokenUpInfo$ = selectWokenUpInfo(workspaceIdStore, agentIdStore);
  const completionStatus$ = selectCompletionStatus(workspaceIdStore, agentIdStore);
  const waitingState$ = selectWaitingState(workspaceIdStore, agentIdStore);

  // ── Derived display values ───────────────────────────────────────────

  // `after_all` delegation groups, each rendered as its own section
  const delegationGroups = $derived($groups$.filter((g) => g.awaitMode === 'all'));

  // Agent IDs from delegation groups (authoritative for "Waiting for all")
  const delegationWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const group of delegationGroups) {
      for (const id of group.expectedAgentIds) ids.add(id);
    }
    return Array.from(ids);
  });

  // Agent IDs from one-shot watches (non-delegation subscriptions). The
  // daemon guarantees watch uniqueness per (parent, target, event), so no
  // client-side dedup beyond the Set here.
  const oneShotWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const sub of $subs$) {
      if (sub.delegationGroup?.awaitMode === 'all') continue;
      for (const actorId of sub.actorIds || []) ids.add(actorId);
    }
    return Array.from(ids);
  });

  // Agents that have finished (completed or deleted) across delegation groups
  const completedAgentIdSet = $derived.by(() => {
    const ids = new Set<string>();
    for (const group of $groups$) {
      for (const id of group.completedAgentIds) ids.add(id);
      for (const id of group.deletedAgentIds) ids.add(id);
    }
    return ids;
  });

  // All watched agent IDs (used for footer visibility only; rendering is
  // split into one-shot rows and per-group sections below)
  const watchedAgentIds = $derived(
    Array.from(new Set([...delegationWatchedIds, ...oneShotWatchedIds])),
  );

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
  const hasUndeliveredCompleteGroup = $derived($groups$.some(isGroupDeliveryPending));

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
  // All wire calls route through the mutation middleware (no IPC in the
  // component); the daemon's `agent:subscriptions-changed` event drives the
  // footer refetch, so no handler mutates the local subscription list.

  /** One-shot row stop: cancel that agent's in-flight stream (`agent.stop`). */
  async function stopWatchedAgent(watchedAgentId: string) {
    if (!workspaceId) return;
    try {
      const action = stopAgentSessionRequested(workspaceId, watchedAgentId);
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      logger.error('Failed to stop watched agent', { watchedAgentId, error });
    }
  }

  /**
   * One-shot row cancel: scoped `agent.cancelSubscriptions { subscriptionId }`
   * for the parent's completion watch on this agent.
   */
  async function cancelWatch(watchedAgentId: string) {
    if (!workspaceId || !agentId) return;
    const watch = $subs$.find(
      (sub) =>
        sub.delegationGroup?.awaitMode !== 'all' &&
        (sub.actorIds || []).includes(watchedAgentId),
    );
    if (!watch) {
      // Refetch race: the watch already fired/was removed between render and
      // click, so there is nothing left to cancel.
      logger.warn('No one-shot watch found to cancel', { watchedAgentId });
      return;
    }
    try {
      const action = cancelAgentSubscriptionsRequested(workspaceId, agentId, {
        subscriptionId: watch.id,
      });
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      logger.error('Failed to cancel watch', { watchedAgentId, error });
    }
  }

  /** Group header stop: stop every still-active agent in the group. */
  async function stopGroup(group: DelegationGroupStatus) {
    if (!workspaceId) return;
    // Completed/deleted members have nothing to stop — including them would
    // just produce spurious daemon-side failures.
    const finished = new Set([...group.completedAgentIds, ...group.deletedAgentIds]);
    const targets = group.expectedAgentIds.filter((id) => !finished.has(id));
    const results = await Promise.allSettled(
      targets.map((id) => {
        const action = stopAgentSessionRequested(workspaceId, id);
        appStore.dispatch(action);
        return action.promise;
      }),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logger.error('Failed to stop group agent', {
          groupId: group.groupId,
          agentId: targets[i],
          error: result.reason,
        });
      }
    });
  }

  /**
   * Group cancel: scoped `agent.cancelSubscriptions { groupId }` — the daemon
   * removes the group plus its grouped watches in one critical section.
   */
  async function cancelGroup(group: DelegationGroupStatus) {
    if (!workspaceId || !agentId) return;
    try {
      const action = cancelAgentSubscriptionsRequested(workspaceId, agentId, {
        groupId: group.groupId,
      });
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      logger.error('Failed to cancel delegation group', { groupId: group.groupId, error });
    }
  }

  function handleActionKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      action();
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
            <span>{m.chat_agentSubscriptions_wokenUp_label()}</span>
            <span class="text-subtle">
              {$wokenUpInfo$.eventCount === 1
                ? m.chat_agentSubscriptions_eventCount_one({
                    count: formatInteger($wokenUpInfo$.eventCount),
                  })
                : m.chat_agentSubscriptions_eventCount_many({
                    count: formatInteger($wokenUpInfo$.eventCount),
                  })}
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" class="text-xs">
          <p>{m.chat_agentSubscriptions_wokenByEvents_tooltip()}</p>
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
    {#if isCompleted || $wokenUpInfo$}
      <!-- Slim status row: transitional "Completed" state and/or "Woken up" pill -->
      <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-subtle">
        {#if isCompleted}
          <span
            class="shrink-0 flex items-center gap-2 whitespace-nowrap text-green-500"
            transition:fade={{ duration: 200 }}
          >
            <Fa icon={faCircleCheck} size="13" />
            {m.chat_agentSubscriptions_completed_label()}
          </span>
        {/if}
        {#if $wokenUpInfo$}
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root delayDuration={0}>
              <Tooltip.Trigger>
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-ui text-subtle bg-muted/50"
                  transition:fade={{ duration: 200 }}
                >
                  <Fa icon={faBell} size="xs" />
                  {m.chat_agentSubscriptions_wokenUp_label()}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content side="top" class="text-xs">
                <p>
                  {$wokenUpInfo$.eventCount === 1
                    ? m.chat_agentSubscriptions_wokenByCount_one({
                        count: formatInteger($wokenUpInfo$.eventCount),
                      })
                    : m.chat_agentSubscriptions_wokenByCount_many({
                        count: formatInteger($wokenUpInfo$.eventCount),
                      })}
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
      </div>
    {/if}

    <!-- One-shot watch rows: individual agent cards, no group chrome -->
    {#if oneShotWatchedIds.length > 0}
      <div
        class="flex flex-col gap-0.5 w-full pl-4.5 pr-2"
        data-testid="one-shot-watches"
        transition:slide={{ duration: 150 }}
      >
        {#each oneShotWatchedIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
          <div
            class="w-full"
            animate:flip={{ duration: 200 }}
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            {#snippet oneShotActions()}
              {#if !isCompleted}
                <!-- span[role=button]: AgentCard's row is itself a <button>, so
                     nested real buttons would be invalid HTML -->
                <span
                  role="button"
                  tabindex="0"
                  aria-label={m.chat_agentSubscriptions_stopAgent_tooltip()}
                  title={m.chat_agentSubscriptions_stopAgent_tooltip()}
                  class="inline-flex items-center justify-center w-5 h-5 rounded text-ghost hover:text-muted-foreground/70 cursor-pointer"
                  data-testid="one-shot-stop"
                  onclick={(e) => {
                    e.stopPropagation();
                    void stopWatchedAgent(watchedAgentId);
                  }}
                  onkeydown={(e) =>
                    handleActionKeydown(e, () => void stopWatchedAgent(watchedAgentId))}
                >
                  <Fa icon={faStop} class="w-2.5! h-2.5!" />
                </span>
                <span
                  role="button"
                  tabindex="0"
                  aria-label={m.chat_agentSubscriptions_cancelWatch_tooltip()}
                  title={m.chat_agentSubscriptions_cancelWatch_tooltip()}
                  class="inline-flex items-center justify-center w-5 h-5 rounded text-ghost hover:text-muted-foreground/70 cursor-pointer"
                  data-testid="one-shot-cancel"
                  onclick={(e) => {
                    e.stopPropagation();
                    void cancelWatch(watchedAgentId);
                  }}
                  onkeydown={(e) =>
                    handleActionKeydown(e, () => void cancelWatch(watchedAgentId))}
                >
                  <Fa icon={faXmark} class="w-2.5! h-2.5!" />
                </span>
              {/if}
            {/snippet}
            <AgentCard
              agentId={watchedAgentId}
              workspace={resolvedWorkspace}
              isCompleted={completedAgentIdSet.has(watchedAgentId)}
              headerActions={oneShotActions}
            />
          </div>
        {/each}
        {#if oneShotWatchedIds.length > 5}
          <div class="text-ui text-subtle text-center py-1">
            {m.chat_shared_moreAgents_label({
              count: formatInteger(oneShotWatchedIds.length - 5),
            })}
          </div>
        {/if}
      </div>
    {/if}

    <!-- One collapsible section per after_all delegation group -->
    {#each delegationGroups as group (group.groupId)}
      <div transition:slide={{ axis: 'y', duration: 200 }}>
        <DelegationGroupSection
          {group}
          workspace={resolvedWorkspace}
          hideActions={isCompleted}
          onStopGroup={stopGroup}
          onCancelGroup={cancelGroup}
        />
      </div>
    {/each}
  </div>
{/if}

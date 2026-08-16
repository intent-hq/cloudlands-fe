<script lang="ts">
  /**
   * AgentSubscriptions Component
   *
   * Footer for what an agent is currently waiting on: one collapsible
   * "Waiting for N agents" section containing every unique watched agent,
   * followed by a brief "Woken up" indicator when a subscription fires.
   *
   * All subscription data comes from Redux selectors (populated by the
   * agent-subscription-ui read saga). No IPC listeners or polling live in
   * this component; short panel-focus retries are owned and cancelled here.
   */
  import { fade } from 'svelte/transition';
  import { safeSlide } from '$lib/utils/animations';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import {
    faBolt,
    faChevronDown,
    faHourglass,
    faXmark,
    faStop,
    faCheck,
    faCircleCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createLogger } from '$lib/utils/client-logger';
  import { onDestroy, tick, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import AgentCard from './AgentCard.svelte';
  import { uniqueAgentIds } from './delegation-ordering';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { selectAgentSessionsByIds } from '$store/renderer/slices/agent-session/agent-session-selectors';

  import {
    selectAgentSubscriptions,
    selectAgentSubscriptionStatuses,
    selectDelegationGroups,
    selectWokenUpInfo,
    selectWaitingState,
  } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
  import {
    cancelAgentSubscriptionsRequested,
    requestSubscriptionFetch,
  } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import { stopAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import type { DelegationGroupStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types';
  import {
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
    SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
    SUBSCRIPTION_CARD_SURFACE_CLASS,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';
  import { store as appStore } from '$store/renderer/store';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { navigateToRoute } from '$lib/utils/navigation.client';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import {
    getFinishedAgentsExpanded,
    getWaitingAgentsExpanded,
    setFinishedAgentsExpanded,
    setWaitingAgentsExpanded,
  } from './agent-subscriptions-view-state';

  const logger = createLogger('AgentSubscriptions');
  const WAITING_AGENT_DISCLOSURE_THRESHOLD = 6;

  function createPropStore<T>(read: () => T) {
    return writable(read());
  }

  function timestampMillis(timestamp?: string | Date): number {
    if (!timestamp) return 0;
    const parsed = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  interface Props {
    workspaceId: string;
    agentId: string;
    compact?: boolean;
    embedded?: boolean;
    visible?: boolean;
    count?: number;
    /** Static rows for daemon-free catalog and visual-test previews. */
    isolatedPreview?: {
      agents: Array<{ id: string; name: string; finished?: boolean }>;
      initiallyExpanded?: boolean;
    };
    /** Promote the cohort disclosure to the sole header in an agent-only parent card. */
    forceWaitingHeader?: boolean;
  }

  let {
    workspaceId,
    agentId,
    compact = false,
    embedded = false,
    visible = $bindable(false),
    count = $bindable(0),
    isolatedPreview,
    forceWaitingHeader = false,
  }: Props = $props();
  const componentId = $props.id();
  const waitingAgentListId = `waiting-agent-list-${componentId}`;
  const finishedAgentListId = `finished-agent-list-${componentId}`;

  // ── Redux selectors (called at component init time) ──────────────────

  // Writable stores mirror prop values so Redux selectors re-evaluate
  // when workspaceId or agentId changes.
  const workspaceIdStore = createPropStore(() => workspaceId);
  const agentIdStore = createPropStore(() => agentId);
  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();
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
    if (isolatedPreview) return;
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
  const agentStatuses$ = selectAgentSubscriptionStatuses(workspaceIdStore, agentIdStore);
  const wokenUpInfo$ = selectWokenUpInfo(workspaceIdStore, agentIdStore);
  const waitingState$ = selectWaitingState(workspaceIdStore, agentIdStore);

  // ── Derived display values ───────────────────────────────────────────

  // Deduplicate repeated snapshots by group id while retaining daemon group order.
  const uniqueDelegationGroups = $derived.by(() => {
    const groupsById = new Map<string, DelegationGroupStatus>();
    for (const group of $groups$) {
      if (group.awaitMode === 'all') groupsById.set(group.groupId, group);
    }
    return Array.from(groupsById.values());
  });

  interface WaitingAgentRow {
    agentId: string;
    agentName?: string;
    fixtureFinished?: boolean;
    cancelSubscriptionId?: string;
    cancelGroupId?: string;
  }

  // One deterministic list: ungrouped watches by source time, then delegation
  // groups in daemon order. Grouped subscription rows are a fallback only when
  // their group snapshot has not arrived yet. The first source owns cancel
  // routing; later duplicate references never add another visible row.
  const waitingAgentRows = $derived.by(() => {
    if (isolatedPreview) {
      return isolatedPreview.agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        fixtureFinished: agent.finished,
      }));
    }
    const rows: WaitingAgentRow[] = [];
    const rowsByAgentId = new Map<string, WaitingAgentRow>();
    const add = (agentId: string, source: Omit<WaitingAgentRow, 'agentId'>) => {
      if (!agentId || rowsByAgentId.has(agentId)) return;
      const row = { agentId, ...source };
      rowsByAgentId.set(agentId, row);
      rows.push(row);
    };
    const subscriptions = [...$subs$].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const sub of subscriptions) {
      if (sub.delegationGroup?.awaitMode === 'all') continue;
      for (const actorId of uniqueAgentIds(sub.actorIds || [])) {
        add(actorId, { cancelSubscriptionId: sub.id });
      }
    }
    const knownGroupIds = new Set<string>();
    for (const group of uniqueDelegationGroups) {
      knownGroupIds.add(group.groupId);
      for (const expectedAgentId of uniqueAgentIds(group.expectedAgentIds)) {
        add(expectedAgentId, { cancelGroupId: group.groupId });
      }
    }
    for (const sub of subscriptions) {
      const group = sub.delegationGroup;
      if (group?.awaitMode !== 'all' || knownGroupIds.has(group.groupId)) continue;
      for (const expectedAgentId of uniqueAgentIds(group.expectedAgentIds)) {
        add(expectedAgentId, { cancelGroupId: group.groupId });
      }
    }
    return rows;
  });

  const watchedAgentIdsStore = writable<string[]>([]);
  $effect(() => {
    watchedAgentIdsStore.set(waitingAgentRows.map((row) => row.agentId));
  });
  const watchedAgentSessions$ = selectAgentSessionsByIds(watchedAgentIdsStore);
  const watchedAgentSessionsById = $derived(
    new Map($watchedAgentSessions$.map((session) => [String(session.id), session])),
  );

  // Agents that have finished (completed or deleted) across delegation groups
  const completedAgentIdSet = $derived.by(() => {
    if (isolatedPreview) {
      return new Set(
        isolatedPreview.agents.filter((agent) => agent.finished).map((agent) => agent.id),
      );
    }
    const ids = new Set<string>();
    for (const group of $groups$) {
      for (const id of group.completedAgentIds) ids.add(id);
      for (const id of group.deletedAgentIds) ids.add(id);
      for (const [id, status] of Object.entries(group.agentStatuses)) {
        if (status === 'completed') ids.add(id);
      }
    }
    for (const [id, status] of Object.entries($agentStatuses$)) {
      if (status === 'completed') ids.add(id);
    }
    return ids;
  });

  // Semantic grouping priority order:
  // 1. attention-required (blocker/discussion)
  // 2. active work (responding/active/processing)
  // 3. idle/waiting
  // 4. terminal (completed/cancelled/deleted/failed)
  function getSemanticPriority(agentId: string): number {
    const session = watchedAgentSessionsById.get(agentId);
    if (!session) return 2; // Default to idle tier

    // Check attention requests first
    if (session.attentionRequestKind === 'blocker') return 0;
    if (session.attentionRequestKind === 'discussion') return 1;

    // Terminal states
    if (completedAgentIdSet.has(agentId)) return 4;

    const status = String(session.status).toLowerCase();

    // Active work
    if (status === 'responding' || status === 'active' || status === 'processing') return 2;

    // Idle/waiting
    return 3;
  }

  const activeAgentRows = $derived.by(() => {
    const nonTerminal = waitingAgentRows.filter((row) => !completedAgentIdSet.has(row.agentId));
    // Stable semantic sort: group by priority, preserve source order within each group
    // Build index map for stable tie-breaking
    const sourceIndexMap = new Map<string, number>();
    waitingAgentRows.forEach((row, idx) => sourceIndexMap.set(row.agentId, idx));

    return nonTerminal.slice().sort((a, b) => {
      const aPriority = getSemanticPriority(a.agentId);
      const bPriority = getSemanticPriority(b.agentId);
      if (aPriority !== bPriority) return aPriority - bPriority;
      // Preserve source order within same priority group (stable tie)
      const aIndex = sourceIndexMap.get(a.agentId) ?? 0;
      const bIndex = sourceIndexMap.get(b.agentId) ?? 0;
      return aIndex - bIndex;
    });
  });

  const finishedAgentRows = $derived.by(() => {
    return waitingAgentRows
      .filter((row) => completedAgentIdSet.has(row.agentId))
      .sort((a, b) => {
        const aTimestamp = timestampMillis(watchedAgentSessionsById.get(a.agentId)?.updatedAt);
        const bTimestamp = timestampMillis(watchedAgentSessionsById.get(b.agentId)?.updatedAt);
        return bTimestamp - aTimestamp || a.agentId.localeCompare(b.agentId);
      });
  });
  const shouldGroupWaitingAgents = $derived(
    forceWaitingHeader || waitingAgentRows.length > WAITING_AGENT_DISCLOSURE_THRESHOLD,
  );
  const shouldGroupFinishedAgents = $derived(
    shouldGroupWaitingAgents && finishedAgentRows.length >= 2,
  );
  const ungroupedAgentRows = $derived(
    shouldGroupFinishedAgents ? activeAgentRows : [...activeAgentRows, ...finishedAgentRows],
  );
  const agentRowIdentityKey = $derived(waitingAgentRows.map((row) => row.agentId).join('\u001f'));
  const latestFinishedAt = $derived(
    shouldGroupFinishedAgents
      ? watchedAgentSessionsById.get(finishedAgentRows[0]?.agentId ?? '')?.updatedAt
      : undefined,
  );

  const isCompleted = $derived($waitingState$ === 'completed');

  // This state intentionally survives reactive list updates.
  let waitingAgentsCollapsed: boolean = $state(true);
  let waitingDisclosureKey = $state('');
  let finishedAgentsExpanded = $state(false);
  let finishedDisclosureKey = $state('');
  let subscriptionCardElement: HTMLElement | undefined = $state();
  let lastFocusedRowControl: { agentId: string; controlIndex: number } | null = $state(null);
  let focusRestoreVersion = 0;

  function rememberFocusedRowControl(event: FocusEvent) {
    const target = event.target as HTMLElement | null;
    const owner = target?.closest<HTMLElement>('[data-subscription-motion-row][data-agent-id]');
    if (!target || !owner) return;
    const controls = Array.from(owner.querySelectorAll<HTMLElement>('button, [href], [tabindex]'));
    const controlIndex = controls.indexOf(target);
    if (controlIndex >= 0) {
      lastFocusedRowControl = { agentId: owner.dataset.agentId ?? '', controlIndex };
    }
  }

  $effect(() => {
    agentRowIdentityKey;
    const focus = untrack(() => lastFocusedRowControl);
    const version = ++focusRestoreVersion;
    if (!focus?.agentId) return;
    void tick().then(() => {
      if (version !== focusRestoreVersion || !subscriptionCardElement) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const owner = Array.from(
        subscriptionCardElement.querySelectorAll<HTMLElement>(
          '[data-subscription-motion-row][data-agent-id]',
        ),
      ).find((row) => row.dataset.agentId === focus.agentId);
      const controls = owner?.querySelectorAll<HTMLElement>('button, [href], [tabindex]');
      controls?.[focus.controlIndex]?.focus();
    });
  });

  $effect(() => {
    const nextKey = `${workspaceId}:${agentId}`;
    if (nextKey !== waitingDisclosureKey) {
      waitingDisclosureKey = nextKey;
      waitingAgentsCollapsed = isolatedPreview
        ? !(isolatedPreview.initiallyExpanded ?? false)
        : !getWaitingAgentsExpanded(workspaceId, agentId);
    }
    if (nextKey === finishedDisclosureKey) return;
    finishedDisclosureKey = nextKey;
    finishedAgentsExpanded = getFinishedAgentsExpanded(workspaceId, agentId);
  });

  function toggleWaitingAgentsCollapsed() {
    waitingAgentsCollapsed = !waitingAgentsCollapsed;
    if (!isolatedPreview) setWaitingAgentsExpanded(workspaceId, agentId, !waitingAgentsCollapsed);
  }

  function toggleFinishedAgentsExpanded() {
    finishedAgentsExpanded = !finishedAgentsExpanded;
    setFinishedAgentsExpanded(workspaceId, agentId, finishedAgentsExpanded);
  }

  const showSubscriptionRow = $derived(isCompleted || waitingAgentRows.length > 0);

  $effect(() => {
    visible = showSubscriptionRow || !!$wokenUpInfo$;
    count = waitingAgentRows.length;
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
   * for the parent's completion watch on this agent. Rows sourced from a
   * merged single-agent group cancel the whole group (`{ groupId }`) instead,
   * so the daemon removes the group plus its grouped watches together.
   */
  async function cancelWatch(row: WaitingAgentRow) {
    if (!workspaceId || !agentId) return;
    const scope = row.cancelSubscriptionId
      ? { subscriptionId: row.cancelSubscriptionId }
      : row.cancelGroupId
        ? { groupId: row.cancelGroupId }
        : null;
    if (!scope) {
      // Refetch race: the watch already fired/was removed between render and
      // click, so there is nothing left to cancel.
      logger.warn('No watch found to cancel', { watchedAgentId: row.agentId });
      return;
    }
    try {
      const action = cancelAgentSubscriptionsRequested(workspaceId, agentId, scope);
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      logger.error('Failed to cancel watch', { watchedAgentId: row.agentId, error });
    }
  }

  function handleActionKeydown(event: KeyboardEvent, action: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  }

  const watchedAgentFocusTimers = new Set<ReturnType<typeof setTimeout>>();
  let watchedAgentFocusOwner: {
    workspaceId: string;
    parentAgentId: string;
    watchedAgentId: string;
  } | null = null;

  function clearWatchedAgentFocusTimers() {
    for (const timer of watchedAgentFocusTimers) clearTimeout(timer);
    watchedAgentFocusTimers.clear();
    watchedAgentFocusOwner = null;
  }

  function focusWatchedAgentPanel(watchedAgentId: string) {
    clearWatchedAgentFocusTimers();
    const owner = { workspaceId, parentAgentId: agentId, watchedAgentId };
    watchedAgentFocusOwner = owner;
    for (const delay of [150, 600]) {
      const timer = setTimeout(() => {
        watchedAgentFocusTimers.delete(timer);
        if (
          watchedAgentFocusOwner !== owner ||
          workspaceId !== owner.workspaceId ||
          agentId !== owner.parentAgentId ||
          selectCurrentWorkspaceTabId.select(appStore.state) !== owner.workspaceId
        ) {
          return;
        }
        dispatchWindowEvent('panel:focus-content', {
          tabType: 'agent',
          agentId: owner.watchedAgentId,
          workspaceId: owner.workspaceId,
        });
        if (watchedAgentFocusTimers.size === 0) watchedAgentFocusOwner = null;
      }, delay);
      watchedAgentFocusTimers.add(timer);
    }
  }

  $effect(() => {
    const activeWorkspaceId = $currentWorkspaceTabId$;
    const currentWorkspaceId = workspaceId;
    const currentParentAgentId = agentId;
    if (
      watchedAgentFocusOwner &&
      (activeWorkspaceId !== watchedAgentFocusOwner.workspaceId ||
        currentWorkspaceId !== watchedAgentFocusOwner.workspaceId ||
        currentParentAgentId !== watchedAgentFocusOwner.parentAgentId)
    ) {
      clearWatchedAgentFocusTimers();
    }
  });

  onDestroy(() => {
    clearWatchedAgentFocusTimers();
  });

  function openWatchedAgent(event: MouseEvent | KeyboardEvent, watchedAgentId: string) {
    if (isolatedPreview) return;
    if (!workspaceId) return;
    const sourcePanelId = findSourcePanelId(event.target);
    if (selectCurrentWorkspaceTabId.select(appStore.state) !== workspaceId) {
      appStore.dispatch(openWorkspaceTab(workspaceId));
      void navigateToRoute(`/workspace/${workspaceId}`).catch((error) => {
        logger.warn('Failed to switch workspace for watched agent', { watchedAgentId, error });
      });
    }
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId: watchedAgentId,
        sourcePanelId,
        openInAdjacentPanel: true,
      }),
    );
    focusWatchedAgentPanel(watchedAgentId);
  }
</script>

{#snippet watchedAgentRow(row: WaitingAgentRow, finished: boolean)}
  {@const watchedAgentId = row.agentId}
  <div
    class="group/watch w-full min-w-0 max-w-full overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
    data-agent-id={watchedAgentId}
    data-subscription-motion-row={finished ? 'finished' : 'waiting'}
    transition:safeSubscriptionRowTransition
  >
    {#snippet oneShotActions()}
      {#if !isCompleted && !isolatedPreview}
        {#if !finished}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.chat_agentSubscriptions_stopAgent_tooltip()}
            title={m.chat_agentSubscriptions_stopAgent_tooltip()}
            class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ghost opacity-0 transition-opacity hover:text-muted-foreground/70 focus-visible:opacity-100 group-hover/watch:opacity-100 group-focus-within/watch:opacity-100"
            data-testid="one-shot-stop"
            onclick={(e) => {
              e.stopPropagation();
              void stopWatchedAgent(watchedAgentId);
            }}
          >
            <Fa icon={faStop} class="h-3.5! w-3.5!" />
          </Button>
        {/if}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.chat_agentSubscriptions_cancelWatch_tooltip()}
          title={m.chat_agentSubscriptions_cancelWatch_tooltip()}
          class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ghost opacity-0 transition-opacity hover:text-muted-foreground/70 focus-visible:opacity-100 group-hover/watch:opacity-100 group-focus-within/watch:opacity-100"
          data-testid="one-shot-cancel"
          onclick={(e) => {
            e.stopPropagation();
            void cancelWatch(row);
          }}
        >
          <Fa icon={faXmark} class="h-3.5! w-3.5!" />
        </Button>
      {/if}
    {/snippet}
    <AgentCard
      agentId={watchedAgentId}
      agentName={row.agentName}
      workspace={resolvedWorkspace}
      isCompleted={finished}
      headerActions={oneShotActions}
      inline
      inlineRowClass={SUBSCRIPTION_ROW_GEOMETRY_CLASS}
      typographyClass={SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}
      onclick={(event) => openWatchedAgent(event, watchedAgentId)}
      readOnly={!!isolatedPreview}
    />
  </div>
{/snippet}

{#if $wokenUpInfo$ && !showSubscriptionRow}
  <!-- Standalone woken-up indicator: shown only when no subscription row is active -->
  <div
    class="flex items-end gap-2 px-3 py-2 text-subtle font-family-child {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    data-compact={compact}
    transition:safeSlide={{ axis: 'y', duration: 200 }}
  >
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root delayDuration={0}>
        <Tooltip.Trigger>
          <div class="shrink-0 flex items-center gap-2 pt-1.5 pb-0.5 text-subtle">
            <Fa icon={faBolt} size={14} class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}" />
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
  <div
    bind:this={subscriptionCardElement}
    class="{SUBSCRIPTION_CARD_CONTAINMENT_CLASS} {embedded ? '' : SUBSCRIPTION_CARD_SURFACE_CLASS}"
    data-conversation-layer="watched-agents"
    data-testid="agent-subscriptions-card"
    data-compact={compact}
    onfocusin={rememberFocusedRowControl}
  >
    {#if isCompleted || $wokenUpInfo$}
      <!-- Slim status row: transitional "Completed" state and/or "Woken up" pill -->
      <div
        class="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden px-3 pt-1.5 pb-1 text-subtle {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
      >
        {#if isCompleted}
          <span
            class="shrink-0 flex items-center gap-2 whitespace-nowrap text-green-500"
            transition:fade={{ duration: 200 }}
          >
            <Fa icon={faCircleCheck} size={14} class="h-3.5! w-3.5! shrink-0" />
            {m.chat_agentSubscriptions_completed_label()}
          </span>
        {/if}
        {#if $wokenUpInfo$}
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root delayDuration={0}>
              <Tooltip.Trigger>
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-subtle bg-muted/50 {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
                  transition:fade={{ duration: 200 }}
                >
                  <Fa
                    icon={faBolt}
                    size={14}
                    class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
                  />
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

    <!-- One top-level waiting disclosure for every unique watched agent. -->
    {#if waitingAgentRows.length > 0}
      <div
        class="w-full min-w-0 max-w-full overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
        data-testid="one-shot-watches"
        transition:safeSlide={{ duration: 150 }}
      >
        {#if shouldGroupWaitingAgents}
          <!-- Section header: compact waiting summary and disclosure for large lists. -->
          <div
            class="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-foreground {SUBSCRIPTION_ROW_GEOMETRY_CLASS}"
            data-testid="one-shot-header"
          >
            <button
              type="button"
              class="min-w-0 flex-1 rounded border-none bg-transparent p-0 text-left font-[inherit] text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring {SUBSCRIPTION_LEADING_CONTENT_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
              data-testid="one-shot-summary-toggle"
              data-subscription-row="agent-watch"
              aria-expanded={!waitingAgentsCollapsed}
              aria-controls={waitingAgentListId}
              onclick={toggleWaitingAgentsCollapsed}
              onkeydown={(event) => handleActionKeydown(event, toggleWaitingAgentsCollapsed)}
            >
              <span
                class="{SUBSCRIPTION_LEADING_COLUMN_CLASS} text-foreground opacity-100"
                data-testid="one-shot-leading-column"
              >
                <Fa
                  icon={faHourglass}
                  size={14}
                  class="h-3.5! w-3.5! shrink-0 text-foreground opacity-100"
                />
              </span>
              <span
                class="min-w-0 truncate whitespace-nowrap text-foreground"
                data-testid="one-shot-summary-title"
              >
                {waitingAgentRows.length === 1
                  ? m.chat_agentSubscriptions_waitingForAgents_one({
                      count: formatInteger(waitingAgentRows.length),
                    })
                  : m.chat_agentSubscriptions_waitingForAgents_many({
                      count: formatInteger(waitingAgentRows.length),
                    })}
              </span>
            </button>
            <button
              type="button"
              class="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-ghost transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="one-shot-collapse-toggle"
              aria-expanded={!waitingAgentsCollapsed}
              aria-controls={waitingAgentListId}
              aria-label={waitingAgentsCollapsed
                ? m.chat_agentSubscriptions_expandWatches_ariaLabel()
                : m.chat_agentSubscriptions_collapseWatches_ariaLabel()}
              onclick={toggleWaitingAgentsCollapsed}
              onkeydown={(event) => handleActionKeydown(event, toggleWaitingAgentsCollapsed)}
            >
              <span class="inline-flex" data-testid="one-shot-chevron">
                <Fa
                  icon={faChevronDown}
                  class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {waitingAgentsCollapsed
                    ? 'rotate-90'
                    : ''}"
                />
              </span>
            </button>
          </div>
        {/if}

        <!-- Complete deduplicated list with per-agent actions. -->
        {#if !shouldGroupWaitingAgents || !waitingAgentsCollapsed}
          <div
            id={waitingAgentListId}
            class="flex w-full min-w-0 max-w-full flex-col overflow-hidden {shouldGroupWaitingAgents
              ? SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS
              : ''}"
            data-testid="one-shot-agent-list"
            data-agent-list-mode={shouldGroupWaitingAgents ? 'grouped' : 'direct'}
            transition:safeSubscriptionSlide
          >
            {#each ungroupedAgentRows as row (row.agentId)}
              {@render watchedAgentRow(row, completedAgentIdSet.has(row.agentId))}
            {/each}
            {#if shouldGroupFinishedAgents}
              <div
                class="w-full min-w-0 max-w-full overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
                data-testid="finished-agent-group"
                data-finished-at={latestFinishedAt}
              >
                <button
                  type="button"
                  class="w-full min-w-0 max-w-full cursor-pointer overflow-hidden text-left text-subtle hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring {SUBSCRIPTION_LEADING_CONTENT_CLASS} {SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
                  data-testid="finished-agent-summary"
                  data-subscription-row="grouped-summary"
                  aria-expanded={finishedAgentsExpanded}
                  aria-controls={finishedAgentListId}
                  onclick={toggleFinishedAgentsExpanded}
                  onkeydown={(event) => handleActionKeydown(event, toggleFinishedAgentsExpanded)}
                >
                  <span
                    class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
                    data-testid="finished-agent-leading-column"
                  >
                    <Fa
                      icon={faCheck}
                      size={14}
                      class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
                    />
                  </span>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="min-w-0 flex-1 truncate whitespace-nowrap">
                      {m.chat_agentSubscriptions_finished_many({
                        count: formatInteger(finishedAgentRows.length),
                      })}
                    </span>
                    {#if latestFinishedAt}
                      <RelativeTime
                        date={latestFinishedAt}
                        compact
                        class="shrink-0 text-ui font-normal text-muted-foreground/70"
                      />
                    {/if}
                    <span
                      class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
                      data-testid="finished-agent-chevron"
                    >
                      <Fa
                        icon={faChevronDown}
                        class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {finishedAgentsExpanded
                          ? ''
                          : '-rotate-90'}"
                      />
                    </span>
                  </span>
                </button>
                {#if finishedAgentsExpanded}
                  <div
                    id={finishedAgentListId}
                    class="flex w-full min-w-0 max-w-full flex-col overflow-hidden {SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS}"
                    data-testid="finished-agent-list"
                    transition:safeSubscriptionSlide
                  >
                    {#each finishedAgentRows as row (row.agentId)}
                      {@render watchedAgentRow(row, true)}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

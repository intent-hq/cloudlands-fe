<script lang="ts">
  import type { AgentSession } from '$shared/types';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import LazyAgentCard from './LazyAgentCard.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import { ListEmpty } from '$lib/components/ui/list';
  import VirtualList from '$lib/components/ui/VirtualList.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import {
    filterWorkspaceAgentRows,
    getFlatWorkspaceAgentRows,
    isBackgroundAgentSession as isBackgroundAgent,
    isCoordinatorAgentSession as isCoordinator,
    shouldVirtualizeWorkspaceAgentRows,
    WORKSPACE_AGENT_ROW_HEIGHT,
  } from './workspace-agents-list-utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { getPanelTabOpenState } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  interface Props {
    agents?: AgentSession[];
    selectedAgentId?: string | null;
    onSelect?: (detail: { agentId: string }) => void;
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    runningAgentIds?: string[];
    loading?: boolean;
    workspaceId?: string;
    openPanelTabs?: PanelTab[];
    activePanelTab?: PanelTab | null;
    searchQuery?: string;
  }

  let {
    agents = [],
    selectedAgentId = null,
    onSelect,
    onCreate,
    onCreateWithSpecialist,
    runningAgentIds = [],
    loading = false,
    workspaceId = '',
    openPanelTabs = [],
    activePanelTab,
    searchQuery = '',
  }: Props = $props();

  const flatAgentRows = $derived(getFlatWorkspaceAgentRows(agents));
  const filteredAgentRows = $derived(filterWorkspaceAgentRows(flatAgentRows, searchQuery));
  const hasActiveSearch = $derived(Boolean(searchQuery.trim()));
  const runningAgentIdSet = $derived(new Set(runningAgentIds));
  const directChildrenByAgentId = $derived.by(() => {
    const children = new Map<string, AgentSession[]>();
    const ancestors: { id: string; depth: number }[] = [];

    for (const row of filteredAgentRows) {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= row.depth) {
        ancestors.pop();
      }
      const parent = ancestors[ancestors.length - 1];
      if (parent?.depth === row.depth - 1) {
        const siblings = children.get(parent.id) ?? [];
        siblings.push(row.agent);
        children.set(parent.id, siblings);
      }
      ancestors.push({ id: row.agent.id, depth: row.depth });
    }

    return children;
  });
  const topLevelAgents = $derived(
    filteredAgentRows.filter((row) => row.depth === 0).map((row) => row.agent),
  );
  const topLevelForegroundAgents = $derived(
    topLevelAgents.filter((agent) => !isBackgroundAgent(agent)),
  );
  const standaloneBackgroundAgents = $derived(
    topLevelAgents.filter((agent) => isBackgroundAgent(agent)),
  );
  const hasCoordinator = $derived(topLevelForegroundAgents.some(isCoordinator));
  // Fall back to the regular list when delegations exist (tree heights are variable)
  // or a coordinator is present (its section headers need the regular rendering).
  const shouldUseVirtual = $derived(shouldVirtualizeWorkspaceAgentRows(filteredAgentRows));
  // The selectable row and lazy placeholder share this exact single-line height.
  const itemHeight = WORKSPACE_AGENT_ROW_HEIGHT;
  const containerHeight = 600;
  let expandedAgentIds = $state(new Set<string>());
  let showBackgroundAgents = $state(false);
  const runningBackgroundCount = $derived(
    standaloneBackgroundAgents.filter((agent) => isAgentRunning(agent.id)).length,
  );

  function isAgentRunning(agentId: string): boolean {
    return runningAgentIdSet.has(agentId);
  }

  function toggleDelegation(agentId: string) {
    const next = new Set(expandedAgentIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    expandedAgentIds = next;
  }

  function handleAgentClick(agentId: string) {
    onSelect?.({ agentId });
  }

  function getAgentPanelState(agentId: string) {
    return getPanelTabOpenState(openPanelTabs, activePanelTab, workspaceId, {
      type: 'agent',
      agentId,
      workspaceId,
    });
  }
</script>

{#snippet agentTree(agentList: AgentSession[])}
  {#each agentList as agent (agent.id)}
    {@const panelState = getAgentPanelState(agent.id)}
    <LazyAgentCard
      cacheKey={agent.id}
      agentId={agent.id}
      agentName={agent.name}
      isBackground={isBackgroundAgent(agent)}
      selected={agent.id === selectedAgentId}
      openPanelCount={panelState.count}
      activeInPanel={panelState.isActive}
      updatedAt={agent.updatedAt}
      hidePreview
      panelRow
      onclick={() => handleAgentClick(agent.id)}
    />

    {@const children = directChildrenByAgentId.get(agent.id) ?? []}
    {#if children.length > 0}
      {@const isExpanded = hasActiveSearch || expandedAgentIds.has(agent.id)}
      {@const runningChildren = children.filter((child) => isAgentRunning(child.id))}
      <div class="mb-2" style="padding-left: 26px;">
        <Button
          variant="ghost-light"
          size="sm"
          class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onclick={(event) => {
            event.stopPropagation();
            toggleDelegation(agent.id);
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded
            ? m.ui_vscodePanel_collapse_ariaLabel()
            : m.ui_vscodePanel_expand_ariaLabel()}
          data-agent-delegation-toggle={agent.id}
        >
          <span class="truncate text-left">
            {#if !isExpanded && runningChildren.length > 0}
              {m.workspace_agentsList_delegatedRunning_label({
                running: formatInteger(runningChildren.length),
                total: formatInteger(children.length),
              })}
            {:else}
              {m.workspace_agentsList_delegated_label({ count: formatInteger(children.length) })}
            {/if}
          </span>
          <Fa
            icon={faChevronDown}
            size="xs"
            class="ml-auto shrink-0 opacity-50 transition-transform duration-200 {isExpanded
              ? ''
              : 'rotate-90'}"
          />
        </Button>

        {#if isExpanded}
          <div class="flex flex-col gap-0.5" transition:slide={{ axis: 'y', duration: 150 }}>
            {@render agentTree(children)}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

{#if onCreate || onCreateWithSpecialist}
  <div class="px-3 mt-0.5">
    <CreateAgentSection {onCreate} {onCreateWithSpecialist} />
  </div>
{/if}

{#if loading}
  <div class="space-y-2 py-2">
    {#each [1, 2, 3] as { }}
      <div class="flex h-10 items-center gap-2 rounded-md px-2">
        <Skeleton class="size-6 shrink-0 rounded-md" />
        <Skeleton class="h-3.5 w-24" />
      </div>
    {/each}
  </div>
{:else if topLevelForegroundAgents.length === 0 && standaloneBackgroundAgents.length === 0}
  <ListEmpty
    message={hasActiveSearch
      ? m.workspace_agentsList_noSearchResults_label()
      : m.workspace_agentsList_empty_label()}
    class={hasActiveSearch ? 'min-h-14 py-3' : undefined}
    role="status"
    aria-live="polite"
  />
{:else if shouldUseVirtual}
  <!-- Virtual scrolling fallback (flat, no delegations, no coordinator) -->
  <div class="h-full max-h-150 overflow-hidden">
    <VirtualList
      items={topLevelForegroundAgents}
      {itemHeight}
      {containerHeight}
      getKey={(agent: AgentSession) => agent.id}
    >
      {#snippet children({ item: agent }: { item: AgentSession })}
        {@const panelState = getAgentPanelState(agent.id)}
        <div class="w-full">
          <AgentCard
            agentId={agent.id}
            agentName={agent.name}
            isBackground={false}
            selected={agent.id === selectedAgentId}
            openPanelCount={panelState.count}
            activeInPanel={panelState.isActive}
            updatedAt={agent.updatedAt}
            hidePreview
            panelRow
            onclick={() => handleAgentClick(agent.id)}
          />
        </div>
      {/snippet}
    </VirtualList>
  </div>
{:else}
  <div class="flex flex-col gap-0.5">
    {#if topLevelForegroundAgents.length > 0}
      {#if hasCoordinator}
        <div class="pt-1 pb-0.5">
          <Header size={6}>{m.workspace_agentsList_coordinator_label()}</Header>
        </div>
      {/if}
      {@const coordinatorAgents = topLevelForegroundAgents.filter(isCoordinator)}
      {@const otherAgents = topLevelForegroundAgents.filter((agent) => !isCoordinator(agent))}
      {@render agentTree(coordinatorAgents)}
      {#if otherAgents.length > 0}
        {#if hasCoordinator}
          <div class="pt-2.5 pb-0.5">
            <Header size={6}>{m.workspace_overviewTimeline_yourAgents_label()}</Header>
          </div>
        {/if}
        {@render agentTree(otherAgents)}
      {/if}
    {/if}
  </div>
{/if}

{#if !loading && standaloneBackgroundAgents.length > 0}
  <div class="container w-full min-w-0 pt-2">
    <Button
      variant="ghost-light"
      size="sm"
      class="h-9 w-full min-w-0 gap-1.5 rounded-md px-2 text-sm font-normal hover:bg-muted/45 focus-visible:ring-1 focus-visible:ring-ring"
      onclick={() => (showBackgroundAgents = !showBackgroundAgents)}
      aria-expanded={showBackgroundAgents}
      data-agent-background-toggle
    >
      <span class="min-w-0 flex-1 truncate text-left">
        {#if !showBackgroundAgents && runningBackgroundCount > 0}
          {m.workspace_agentsList_backgroundAgentsRunning_label({
            running: formatInteger(runningBackgroundCount),
            total: formatInteger(standaloneBackgroundAgents.length),
          })}
        {:else}
          {m.workspace_agentsList_backgroundAgents_label({
            count: formatInteger(standaloneBackgroundAgents.length),
          })}
        {/if}
      </span>
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto shrink-0 transition-transform duration-200 {showBackgroundAgents
          ? ''
          : 'rotate-90'}"
      />
    </Button>
  </div>

  <div class="flex flex-col gap-0.5 pt-1">
    {#each standaloneBackgroundAgents as agent (agent.id)}
      {@const panelState = getAgentPanelState(agent.id)}
      {#if hasActiveSearch || showBackgroundAgents || isAgentRunning(agent.id)}
        <div transition:slide={{ axis: 'y', duration: 150 }}>
          <LazyAgentCard
            cacheKey={agent.id}
            agentId={agent.id}
            agentName={agent.name}
            isBackground
            selected={agent.id === selectedAgentId}
            openPanelCount={panelState.count}
            activeInPanel={panelState.isActive}
            updatedAt={agent.updatedAt}
            hidePreview
            panelRow
            onclick={() => handleAgentClick(agent.id)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<script lang="ts">
  import type { AgentSession } from '$shared/types';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import LazyAgentCard from './LazyAgentCard.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import { ListEmpty } from '$lib/components/ui/list';
  import VirtualList from '$lib/components/ui/VirtualList.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { faChevronDown, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import {
    filterWorkspaceAgentRows,
    getFlatWorkspaceAgentRows,
    isBackgroundAgentSession as isBackgroundAgent,
    isCoordinatorAgentSession as isCoordinator,
    isRetiredAgentSession as isRetiredAgent,
    shouldVirtualizeWorkspaceAgentRows,
    WORKSPACE_AGENT_ROW_HEIGHT,
    WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
  } from './workspace-agents-list-utils';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    agents?: AgentSession[];
    selectedAgentId?: string | null;
    onSelect?: (detail: { agentId: string; event?: MouseEvent | KeyboardEvent }) => void;
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    onRestoreRetired?: (detail: { agentId: string }) => void;
    runningAgentIds?: string[];
    loading?: boolean;
    searchQuery?: string;
    /** Daemon-served retired-row count (§5.5 v8.2) — renders the collapsed bin before rows load. */
    retiredCount?: number;
    /** True once the lazy retired-only read has hydrated the retired rows. */
    retiredAgentsLoaded?: boolean;
    /** True while the lazy retired-only read is in flight. */
    loadingRetired?: boolean;
    /** Lazy-load trigger: fired when the Retired bin expands (or a search needs retired rows). */
    onLoadRetired?: () => void;
  }

  let {
    agents = [],
    selectedAgentId = null,
    onSelect,
    onCreate,
    onCreateWithSpecialist,
    onRestoreRetired,
    runningAgentIds = [],
    loading = false,
    searchQuery = '',
    retiredCount = 0,
    retiredAgentsLoaded = false,
    loadingRetired = false,
    onLoadRetired,
  }: Props = $props();

  const activeAgents = $derived(agents.filter((agent) => !isRetiredAgent(agent)));
  // Retired agents render as a flat list (no delegation tree) sorted by recency.
  const retiredAgents = $derived(
    filterWorkspaceAgentRows(
      getFlatWorkspaceAgentRows(agents.filter(isRetiredAgent)).map((row) => ({
        ...row,
        depth: 0,
      })),
      searchQuery,
    ).map((row) => row.agent),
  );
  const flatAgentRows = $derived(getFlatWorkspaceAgentRows(activeAgents));
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
  // The retired bin is always flat with uniform-height rows, so a length check suffices.
  const shouldVirtualizeRetired = $derived(
    retiredAgents.length > WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
  );
  // The selectable row and lazy placeholder share this exact single-line height.
  const itemHeight = WORKSPACE_AGENT_ROW_HEIGHT;
  const containerHeight = 600;
  let expandedAgentIds = $state(new Set<string>());
  let showBackgroundAgents = $state(false);
  let showRetiredAgents = $state(false);
  const runningBackgroundCount = $derived(
    standaloneBackgroundAgents.filter((agent) => isAgentRunning(agent.id)).length,
  );
  // The bin toggle renders from the daemon-served count until the lazy
  // retired-only read hydrates the rows; loaded rows are authoritative after
  // that (they also reflect live retire/restore updates and search filtering).
  const displayedRetiredCount = $derived(
    retiredAgentsLoaded ? retiredAgents.length : Math.max(retiredCount, retiredAgents.length),
  );
  const hasRetiredBin = $derived(displayedRetiredCount > 0);
  // Expanding the bin — or activating a search, which must cover retired
  // agents — lazy-loads the retired rows (§5.5 v8.2). The load fires on the
  // user-action TRANSITION (expand click / search activation), never
  // reactively off `loadingRetired`: a failed read leaves `retiredAgentsLoaded`
  // false, so a state-tracking effect would re-dispatch the moment the loading
  // flag clears — an unbounded hot retry loop against an erroring daemon.
  // Failure semantics are retry-on-next-transition instead (collapse/re-expand
  // or clear/re-type the search); the saga side is idempotent either way
  // (skip-when-loaded + takeLeading single-flight).
  function requestRetiredLoad() {
    if (!hasRetiredBin || retiredAgentsLoaded || loadingRetired) return;
    onLoadRetired?.();
  }

  function toggleRetiredBin() {
    showRetiredAgents = !showRetiredAgents;
    if (showRetiredAgents) requestRetiredLoad();
  }

  // Search activation is a prop transition, not a local event, so watch the
  // edge with an effect tracking ONLY `hasActiveSearch` + `hasRetiredBin`
  // (the load gates are read untracked): it fires once when a search becomes
  // active over a visible bin — including a mount with an active search — and
  // once more if the bin appears while a search is already active (count
  // landing after mount, when the earlier transition consumed itself against
  // the hidden bin). It cannot re-run off loading-state churn: with both edges
  // already true, `fired` stays latched until one of them drops.
  let searchLoadFired = false;
  $effect(() => {
    const wanted = hasActiveSearch && hasRetiredBin;
    if (wanted && !searchLoadFired) untrack(requestRetiredLoad);
    searchLoadFired = wanted;
  });

  function isAgentRunning(agentId: string): boolean {
    return runningAgentIdSet.has(agentId);
  }

  function toggleDelegation(agentId: string) {
    const next = new Set(expandedAgentIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    expandedAgentIds = next;
  }

  function handleAgentClick(agentId: string, event: MouseEvent | KeyboardEvent) {
    onSelect?.({ agentId, event });
  }
</script>

{#snippet agentTree(agentList: AgentSession[])}
  {#each agentList as agent (agent.id)}
    <LazyAgentCard
      cacheKey={agent.id}
      agentId={agent.id}
      agentName={agent.name}
      isBackground={isBackgroundAgent(agent)}
      selected={agent.id === selectedAgentId}
      updatedAt={agent.updatedAt}
      hidePreview
      panelRow
      onclick={(event) => handleAgentClick(agent.id, event)}
    />

    {@const children = directChildrenByAgentId.get(agent.id) ?? []}
    {#if children.length > 0}
      {@const isExpanded = hasActiveSearch || expandedAgentIds.has(agent.id)}
      {@const runningChildren = children.filter((child) => isAgentRunning(child.id))}
      <div class="mb-2" style="padding-left: 26px;">
        <Button
          variant="ghost-light"
          size="sm"
          class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md bg-transparent px-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-0"
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
{:else if topLevelForegroundAgents.length === 0 && standaloneBackgroundAgents.length === 0 && !hasRetiredBin}
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
        <div class="w-full">
          <AgentCard
            agentId={agent.id}
            agentName={agent.name}
            isBackground={false}
            selected={agent.id === selectedAgentId}
            updatedAt={agent.updatedAt}
            hidePreview
            panelRow
            onclick={(event) => handleAgentClick(agent.id, event)}
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
      class="h-9 w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-normal hover:bg-transparent active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-0"
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
      {#if hasActiveSearch || showBackgroundAgents || isAgentRunning(agent.id)}
        <div transition:slide={{ axis: 'y', duration: 150 }}>
          <LazyAgentCard
            cacheKey={agent.id}
            agentId={agent.id}
            agentName={agent.name}
            isBackground
            selected={agent.id === selectedAgentId}
            updatedAt={agent.updatedAt}
            hidePreview
            panelRow
            onclick={(event) => handleAgentClick(agent.id, event)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if !loading && hasRetiredBin}
  <div class="container w-full min-w-0 pt-2">
    <Button
      variant="ghost-light"
      size="sm"
      class="h-9 w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-normal hover:bg-transparent active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-0"
      onclick={toggleRetiredBin}
      aria-expanded={showRetiredAgents}
      data-agent-retired-toggle
    >
      <span class="min-w-0 flex-1 truncate text-left">
        {m.workspace_agentsList_retiredAgents_label({
          count: formatInteger(displayedRetiredCount),
        })}
      </span>
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto shrink-0 transition-transform duration-200 {showRetiredAgents
          ? ''
          : 'rotate-90'}"
      />
    </Button>
  </div>

  {#if (hasActiveSearch || showRetiredAgents) && !retiredAgentsLoaded && retiredAgents.length === 0}
    <!-- Lazy retired-only read in flight (or about to start): skeleton rows.
         Rows already in state (e.g. retired live via agent:retired) render
         immediately below instead — late-loaded rows merge into them. -->
    <div class="space-y-2 py-2" data-agent-retired-loading>
      {#each [1, 2] as { }}
        <div class="flex h-10 items-center gap-2 rounded-md px-2">
          <Skeleton class="size-6 shrink-0 rounded-md" />
          <Skeleton class="h-3.5 w-24" />
        </div>
      {/each}
    </div>
  {:else if shouldVirtualizeRetired}
    {#if hasActiveSearch || showRetiredAgents}
      <!-- Virtual scrolling for large retired sets (flat, uniform-height rows) -->
      <div class="max-h-150 overflow-hidden pt-1" data-agent-retired-section>
        <VirtualList
          items={retiredAgents}
          {itemHeight}
          {containerHeight}
          getKey={(agent: AgentSession) => agent.id}
        >
          {#snippet children({ item: agent }: { item: AgentSession })}
            <div class="w-full opacity-70">
              <AgentCard
                agentId={agent.id}
                agentName={agent.name}
                isBackground={isBackgroundAgent(agent)}
                selected={agent.id === selectedAgentId}
                updatedAt={agent.updatedAt}
                hidePreview
                panelRow
                onclick={(event) => handleAgentClick(agent.id, event)}
              >
                {#snippet headerActions()}
                  {@render retiredActions(agent.id)}
                {/snippet}
              </AgentCard>
            </div>
          {/snippet}
        </VirtualList>
      </div>
    {/if}
  {:else}
    <div class="flex flex-col gap-0.5 pt-1" data-agent-retired-section>
      {#each retiredAgents as agent (agent.id)}
        {#if hasActiveSearch || showRetiredAgents}
          {#snippet rowActions()}
            {@render retiredActions(agent.id)}
          {/snippet}
          <div transition:slide={{ axis: 'y', duration: 150 }} class="opacity-70">
            <LazyAgentCard
              cacheKey={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              isBackground={isBackgroundAgent(agent)}
              selected={agent.id === selectedAgentId}
              updatedAt={agent.updatedAt}
              hidePreview
              panelRow
              onclick={(event) => handleAgentClick(agent.id, event)}
              headerActions={rowActions}
            />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}

{#snippet retiredActions(agentId: string)}
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    aria-label={m.workspace_agentsList_restoreRetired_ariaLabel()}
    title={m.workspace_agentsList_restoreRetired_button()}
    class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ghost opacity-0 transition-opacity hover:text-muted-foreground/70 focus-visible:opacity-100 group-hover/watch:opacity-100 group-focus-within/watch:opacity-100"
    data-testid="agent-restore-retired"
    onclick={(e) => {
      e.stopPropagation();
      onRestoreRetired?.({ agentId });
    }}
  >
    <Fa icon={faRotateLeft} class="h-3.5! w-3.5!" />
  </Button>
{/snippet}

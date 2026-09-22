<script lang="ts">
  import type { AgentDelegatedCounts, AgentScopeCounts, AgentSession } from '$shared/types';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import LazyAgentCard from './LazyAgentCard.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import { ListEmpty } from '$lib/components/ui/list';
  import VirtualList from '$lib/components/ui/VirtualList.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { faChevronDown, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { untrack } from 'svelte';
  import { slide } from '$lib/motion';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import {
    buildWorkspaceAgentListRows,
    filterWorkspaceAgentRows,
    getFlatWorkspaceAgentRows,
    isBackgroundAgentSession as isBackgroundAgent,
    isCoordinatorAgentSession as isCoordinator,
    isRetiredAgentSession as isRetiredAgent,
    shouldVirtualizeWorkspaceAgentRows,
    WORKSPACE_AGENT_ROW_HEIGHT,
    WORKSPACE_AGENT_ROW_INDENT,
    WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
    type WorkspaceAgentListRow,
  } from './workspace-agents-list-utils';
  import { m } from '$shared/paraglide/messages.js';
  import { agentListBinOf } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

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
    /** Daemon-served retired-row count (§5.5 soft retire) — renders the collapsed bin before rows load. */
    retiredCount?: number;
    /** True once the lazy retired-only read has hydrated the retired rows. */
    retiredAgentsLoaded?: boolean;
    /** True while the lazy retired-only read is in flight. */
    loadingRetired?: boolean;
    /** Lazy-load trigger: fired when the Retired bin expands (or a search needs retired rows). */
    onLoadRetired?: () => void;
    /**
     * Daemon-served per-bin counts (`scopeCounts`, §5.5 row scope). When present the
     * default read was `scope: "topLevel"`, so the Delegated and Background bins
     * render collapsed from these counts and lazy-load their rows on expand.
     * `null`/absent = old daemon (all rows already in `agents`; no lazy bins).
     */
    scopeCounts?: AgentScopeCounts | null;
    /** True once the lazy `scope: "delegated"` read has hydrated the delegated rows. */
    delegatedAgentsLoaded?: boolean;
    /** True while the lazy delegated read is in flight. */
    loadingDelegated?: boolean;
    /**
     * Lazy-load trigger: fired without an id when the Delegated bin expands (or a
     * search needs delegated rows), and with a `parentAgentId` when one parent's
     * collapsed delegated group expands before its children are loaded.
     */
    onLoadDelegated?: (parentAgentId?: string) => void;
    /**
     * Daemon-served per-parent delegated counts (`delegatedCounts`, §5.5). When
     * present alongside `scopeCounts`, each parent's delegated group renders from
     * `byParent[agent.id]` before its children load, and the collapsed Delegated
     * bin's running count comes from `running`. `null`/absent = old daemon.
     */
    delegatedCounts?: AgentDelegatedCounts | null;
    /** Parents whose direct children the per-parent delegated read has hydrated. */
    loadedDelegatedParentIds?: Record<string, true>;
    /** Parents whose per-parent delegated read is in flight. */
    loadingDelegatedParentIds?: Record<string, true>;
    /** True once the lazy `scope: "background"` read has hydrated the background rows. */
    backgroundAgentsLoaded?: boolean;
    /** True while the lazy background read is in flight. */
    loadingBackground?: boolean;
    /** Lazy-load trigger: fired when the Background bin expands (or a search needs background rows). */
    onLoadBackground?: () => void;
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
    scopeCounts = null,
    delegatedAgentsLoaded = false,
    loadingDelegated = false,
    onLoadDelegated,
    delegatedCounts = null,
    loadedDelegatedParentIds = {},
    loadingDelegatedParentIds = {},
    backgroundAgentsLoaded = false,
    loadingBackground = false,
    onLoadBackground,
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
  // Lazy-bin mode: the daemon served `scopeCounts`, so `agents` holds only the
  // top-level rows until the Delegated / Background bins are expanded.
  const hasLazyBins = $derived(scopeCounts !== null);
  // Per-parent mode: the daemon also served `delegatedCounts`, so each parent's
  // delegated group renders collapsed from its count and expanding it loads
  // only that parent's children (`scope: "delegated"` + `parentAgentId`).
  const hasDelegatedCounts = $derived(hasLazyBins && delegatedCounts !== null);
  // Bin membership follows the wire parent (`agentListBinOf`, the daemon's
  // §5.5 row-scope rule), never the rendered tree depth: a delegated row
  // whose parent is not loaded (a collapsed Background parent, or a retired
  // one) flattens to depth 0 in the tree but still belongs to the Delegated
  // bin. Without lazy bins there is no Delegated bin, so such an orphan keeps
  // rendering as a top-level row as before.
  const isDelegatedAgent = (agent: AgentSession) => agentListBinOf(agent) === 'delegated';
  const isOrphanDelegatedAgent = (agent: AgentSession) => hasLazyBins && isDelegatedAgent(agent);
  const topLevelForegroundAgents = $derived(
    topLevelAgents.filter((agent) => !isBackgroundAgent(agent) && !isOrphanDelegatedAgent(agent)),
  );
  const standaloneBackgroundAgents = $derived(
    topLevelAgents.filter((agent) => isBackgroundAgent(agent) && !isOrphanDelegatedAgent(agent)),
  );
  const orphanDelegatedAgents = $derived(topLevelAgents.filter(isOrphanDelegatedAgent));
  const hasCoordinator = $derived(topLevelForegroundAgents.some(isCoordinator));
  // A standalone background row renders only while its bin is expanded, a
  // search is active, or it is running (see the Background section below).
  const isBackgroundRowRendered = (agent: AgentSession) =>
    hasActiveSearch || showBackgroundAgents || isAgentRunning(agent.id);
  // Rows the open Delegated bin lists directly: delegated rows with no parent
  // in the tree, plus the children of a LOADED background parent whose own row
  // is not rendered (collapsed Background bin) — otherwise those children
  // would render nowhere while the bin still counts them.
  const delegatedSectionAgents = $derived([
    ...orphanDelegatedAgents,
    ...standaloneBackgroundAgents
      .filter((agent) => !isBackgroundRowRendered(agent))
      .flatMap((agent) => directChildrenByAgentId.get(agent.id) ?? []),
  ]);
  // Both render paths below consume the same row model, so virtualization is a
  // pure size decision: large lists use the flat VirtualList (group bars,
  // skeletons and children included), coordinator workspaces keep the nested
  // list for their section layout.
  const shouldUseVirtual = $derived(shouldVirtualizeWorkspaceAgentRows(filteredAgentRows));
  // The retired bin is always flat with uniform-height rows, so a length check suffices.
  const shouldVirtualizeRetired = $derived(
    retiredAgents.length > WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
  );
  // Every row kind — selectable row, lazy placeholder, group bar, skeleton —
  // shares this exact single-line height so the virtual slots stay uniform.
  const itemHeight = WORKSPACE_AGENT_ROW_HEIGHT;
  const containerHeight = 600;
  const indentFor = (depth: number) => `${depth * WORKSPACE_AGENT_ROW_INDENT}px`;
  // Per-parent delegation groups the user toggled AWAY from their default state.
  // The default is collapsed, except while the workspace-level Delegated bin is
  // expanded (lazy-bin mode): expanding it must reveal the rows it just loaded.
  let toggledDelegationIds = $state(new Set<string>());
  let showDelegatedAgents = $state(false);
  let showBackgroundAgents = $state(false);
  let showRetiredAgents = $state(false);
  const delegatedGroupsDefaultExpanded = $derived(hasLazyBins && showDelegatedAgents);
  // The daemon's `delegated` bin: every parented row (background children
  // included), whether or not its parent is loaded.
  const loadedDelegatedAgents = $derived(activeAgents.filter(isDelegatedAgent));
  // Daemon-served running count until the whole bin is loaded (rows of a
  // collapsed bin are not hydrated, so they cannot be counted locally).
  const runningDelegatedCount = $derived(
    hasDelegatedCounts && !delegatedAgentsLoaded
      ? (delegatedCounts?.running ?? 0)
      : loadedDelegatedAgents.filter((agent) => isAgentRunning(agent.id)).length,
  );
  const runningBackgroundCount = $derived(
    standaloneBackgroundAgents.filter((agent) => isAgentRunning(agent.id)).length,
  );
  // Same count rule as the retired bin below: the daemon-served count until the
  // lazy read hydrates the rows, loaded rows authoritative after that.
  const displayedDelegatedCount = $derived(
    !hasLazyBins
      ? 0
      : delegatedAgentsLoaded
        ? loadedDelegatedAgents.length
        : Math.max(scopeCounts?.delegated ?? 0, loadedDelegatedAgents.length),
  );
  const displayedBackgroundCount = $derived(
    !hasLazyBins || backgroundAgentsLoaded
      ? standaloneBackgroundAgents.length
      : Math.max(scopeCounts?.background ?? 0, standaloneBackgroundAgents.length),
  );
  const hasDelegatedBin = $derived(displayedDelegatedCount > 0);
  const hasBackgroundBin = $derived(displayedBackgroundCount > 0);
  // Without lazy bins every delegated row is already in the tree and nests under
  // its parent as before; with them the tree hides delegated rows until the
  // workspace-level bin is expanded (a search covers every bin).
  const delegatedRowsVisible = $derived(!hasLazyBins || hasActiveSearch || showDelegatedAgents);
  const showDelegatedSkeleton = $derived(
    hasLazyBins &&
      (hasActiveSearch || showDelegatedAgents) &&
      !delegatedAgentsLoaded &&
      loadedDelegatedAgents.length === 0,
  );
  const showBackgroundSkeleton = $derived(
    hasLazyBins &&
      (hasActiveSearch || showBackgroundAgents) &&
      !backgroundAgentsLoaded &&
      standaloneBackgroundAgents.length === 0,
  );
  // The bin toggle renders from the daemon-served count until the lazy
  // retired-only read hydrates the rows; loaded rows are authoritative after
  // that (they also reflect live retire/restore updates and search filtering).
  const displayedRetiredCount = $derived(
    retiredAgentsLoaded ? retiredAgents.length : Math.max(retiredCount, retiredAgents.length),
  );
  const hasRetiredBin = $derived(displayedRetiredCount > 0);
  // Expanding the bin — or activating a search, which must cover retired
  // agents — lazy-loads the retired rows (§5.5 `retiredOnly`). The load fires on the
  // user-action TRANSITION (expand click / search activation), never
  // reactively off `loadingRetired`: a failed read leaves `retiredAgentsLoaded`
  // false, so a state-tracking effect would re-dispatch the moment the loading
  // flag clears — an unbounded hot retry loop against an erroring daemon.
  // Failure semantics are retry-on-next-transition instead (collapse/re-expand
  // or clear/re-type the search); the saga side is idempotent either way
  // (skip-when-loaded + takeLeading single-flight).
  // The Delegated and Background bins (`scopeCounts`) follow the identical
  // transition-triggered contract.
  function requestRetiredLoad() {
    if (!hasRetiredBin || retiredAgentsLoaded || loadingRetired) return;
    onLoadRetired?.();
  }

  function requestDelegatedLoad() {
    if (!hasLazyBins || !hasDelegatedBin || delegatedAgentsLoaded || loadingDelegated) return;
    onLoadDelegated?.();
  }

  function requestBackgroundLoad() {
    if (!hasLazyBins || !hasBackgroundBin || backgroundAgentsLoaded || loadingBackground) return;
    onLoadBackground?.();
  }

  function isDelegatedParentLoaded(agentId: string): boolean {
    return delegatedAgentsLoaded || loadedDelegatedParentIds[agentId] === true;
  }

  // Same transition-triggered contract as the bins: fires when one parent's
  // group expands before its children are loaded, and never while the whole-bin
  // read (which covers every parent) is in flight.
  function requestDelegatedParentLoad(agentId: string) {
    if (!hasDelegatedCounts || loadingDelegated) return;
    if (isDelegatedParentLoaded(agentId) || loadingDelegatedParentIds[agentId] === true) return;
    onLoadDelegated?.(agentId);
  }

  function toggleRetiredBin() {
    showRetiredAgents = !showRetiredAgents;
    if (showRetiredAgents) requestRetiredLoad();
  }

  function toggleDelegatedBin() {
    showDelegatedAgents = !showDelegatedAgents;
    // Per-parent overrides are relative to the bin's default, so reset them on
    // every bin transition: expanding shows every group, collapsing hides all.
    toggledDelegationIds = new Set();
    if (showDelegatedAgents) requestDelegatedLoad();
  }

  function toggleBackgroundBin() {
    showBackgroundAgents = !showBackgroundAgents;
    if (showBackgroundAgents) requestBackgroundLoad();
  }

  // Search activation is a prop transition, not a local event, so watch the
  // edge with an effect tracking ONLY `hasActiveSearch` + the bin's presence
  // (the load gates are read untracked): it fires once when a search becomes
  // active over a visible bin — including a mount with an active search — and
  // once more if the bin appears while a search is already active (count
  // landing after mount, when the earlier transition consumed itself against
  // the hidden bin). It cannot re-run off loading-state churn: with both edges
  // already true, `fired` stays latched until one of them drops.
  function loadBinOnSearch(hasBin: () => boolean, request: () => void) {
    let fired = false;
    $effect(() => {
      const wanted = hasActiveSearch && hasBin();
      if (wanted && !fired) untrack(request);
      fired = wanted;
    });
  }
  loadBinOnSearch(() => hasRetiredBin, requestRetiredLoad);
  loadBinOnSearch(() => hasDelegatedBin, requestDelegatedLoad);
  loadBinOnSearch(() => hasBackgroundBin, requestBackgroundLoad);

  function isAgentRunning(agentId: string): boolean {
    return runningAgentIdSet.has(agentId);
  }

  function isDelegationExpanded(agentId: string): boolean {
    if (hasActiveSearch) return true;
    return toggledDelegationIds.has(agentId) !== delegatedGroupsDefaultExpanded;
  }

  function toggleDelegation(agentId: string) {
    const expanding = !isDelegationExpanded(agentId);
    const next = new Set(toggledDelegationIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    toggledDelegationIds = next;
    if (expanding) requestDelegatedParentLoad(agentId);
  }

  function handleAgentClick(agentId: string, event: MouseEvent | KeyboardEvent) {
    onSelect?.({ agentId, event });
  }

  // The single row model both render paths consume (see the `listRow` snippet).
  // Per-parent mode keeps each group (and its loaded children) addressable while
  // the workspace-level bin is collapsed: the group renders from the daemon
  // count and expands on its own. Otherwise the rows hide delegated children
  // until the bin is expanded, as before.
  function buildRows(agentList: AgentSession[]): WorkspaceAgentListRow[] {
    return buildWorkspaceAgentListRows(agentList, {
      getChildren: (agentId) =>
        delegatedRowsVisible || hasDelegatedCounts
          ? (directChildrenByAgentId.get(agentId) ?? [])
          : [],
      // Daemon-served `{ total, running }` until this parent's children are
      // hydrated; the loaded rows are authoritative after that.
      getCountedChildren: (agentId) =>
        hasDelegatedCounts && !isDelegatedParentLoaded(agentId)
          ? delegatedCounts?.byParent[agentId]
          : undefined,
      isExpanded: isDelegationExpanded,
      isRunning: isAgentRunning,
      binSkeletonShown: showDelegatedSkeleton,
    });
  }

  const listRows = $derived.by((): WorkspaceAgentListRow[] => {
    if (!hasCoordinator) return buildRows(topLevelForegroundAgents);
    const coordinatorAgents = topLevelForegroundAgents.filter(isCoordinator);
    const otherAgents = topLevelForegroundAgents.filter((agent) => !isCoordinator(agent));
    const rows: WorkspaceAgentListRow[] = [
      { kind: 'header', key: 'header:coordinator', depth: 0, section: 'coordinator' },
      ...buildRows(coordinatorAgents),
    ];
    if (otherAgents.length > 0) {
      rows.push(
        { kind: 'header', key: 'header:yourAgents', depth: 0, section: 'yourAgents' },
        ...buildRows(otherAgents),
      );
    }
    return rows;
  });
  const delegatedSectionRows = $derived(buildRows(delegatedSectionAgents));
</script>

<!-- The one row renderer. Both the nested list (`rowList`) and the flat
     VirtualList render every row kind through it; `lazy` picks the
     IntersectionObserver-deferred card for the nested path (the virtual path
     already bounds the mounted rows). Each row root is exactly one row tall. -->
{#snippet listRow(row: WorkspaceAgentListRow, lazy: boolean)}
  {#if row.kind === 'header'}
    <div
      class={row.section === 'coordinator' ? 'w-full pt-1 pb-0.5' : 'w-full pt-2.5 pb-0.5'}
      data-agent-list-row="header"
    >
      <Header size={6}>
        {row.section === 'coordinator'
          ? m.workspace_agentsList_coordinator_label()
          : m.workspace_overviewTimeline_yourAgents_label()}
      </Header>
    </div>
  {:else if row.kind === 'agent'}
    {@const agent = row.agent}
    <div class="w-full" style:padding-left={indentFor(row.depth)} data-agent-list-row="agent">
      {#if lazy}
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
      {:else}
        <AgentCard
          agentId={agent.id}
          agentName={agent.name}
          isBackground={isBackgroundAgent(agent)}
          selected={agent.id === selectedAgentId}
          updatedAt={agent.updatedAt}
          hidePreview
          panelRow
          onclick={(event) => handleAgentClick(agent.id, event)}
        />
      {/if}
    </div>
  {:else if row.kind === 'delegatedGroup'}
    {@const agent = row.parent}
    {@const isExpanded = row.expanded}
    <!-- Align the toggle text with the parent avatar + gap; the vertical
         padding pads the h-7 bar out to the shared row height. -->
    <div
      class="w-full py-1.5"
      style:padding-left={indentFor(row.depth)}
      data-agent-list-row="delegatedGroup"
    >
      <Button
        variant="ghost-light"
        size="sm"
        class="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md bg-transparent px-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-0"
        style="padding-left: calc(var(--agent-avatar-emphasized-surface-size) + 0.5rem);"
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
          {#if !isExpanded && row.running > 0}
            {m.workspace_agentsList_delegatedRunning_label({
              running: formatInteger(row.running),
              total: formatInteger(row.total),
            })}
          {:else}
            {m.workspace_agentsList_delegated_label({ count: formatInteger(row.total) })}
          {/if}
        </span>
        <Fa
          icon={faChevronDown}
          size="xs"
          class="ml-auto shrink-0 opacity-50 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {isExpanded
            ? ''
            : 'rotate-90'}"
        />
      </Button>
    </div>
  {:else}
    <!-- Per-parent read in flight (or about to start): skeleton rows under the
         parent. The whole-bin read shows the bin's skeleton below instead. -->
    <div
      class="flex h-10 w-full items-center gap-2 rounded-md px-2"
      style:padding-left={indentFor(row.depth)}
      data-agent-list-row="delegatedSkeleton"
      data-agent-delegation-loading={row.parentId}
    >
      <Skeleton class="size-6 shrink-0 rounded-md" />
      <Skeleton class="h-3.5 w-24" />
    </div>
  {/if}
{/snippet}

<!-- Nested (non-virtual) list over the shared rows. Nested rows slide in and
     out as their group expands or collapses; top-level rows stay static. -->
{#snippet rowList(rows: WorkspaceAgentListRow[])}
  {#each rows as row (row.key)}
    {#if row.depth > 0}
      <div transition:slide={{ axis: 'y', tier: 'moderate' }}>
        {@render listRow(row, true)}
      </div>
    {:else}
      {@render listRow(row, true)}
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
{:else if topLevelForegroundAgents.length === 0 && !hasDelegatedBin && !hasBackgroundBin && !hasRetiredBin}
  <ListEmpty
    message={hasActiveSearch
      ? m.workspace_agentsList_noSearchResults_label()
      : m.workspace_agentsList_empty_label()}
    class={hasActiveSearch ? 'min-h-14 py-3' : undefined}
    role="status"
    aria-live="polite"
  />
{:else if shouldUseVirtual}
  <!-- Virtual scrolling over the same rows the nested list renders (flat,
       uniform-height slots; large lists without a coordinator). -->
  <div class="h-full max-h-150 overflow-hidden">
    <VirtualList
      items={listRows}
      {itemHeight}
      {containerHeight}
      getKey={(row: WorkspaceAgentListRow) => row.key}
    >
      {#snippet children({ item: row }: { item: WorkspaceAgentListRow })}
        {@render listRow(row, false)}
      {/snippet}
    </VirtualList>
  </div>
{:else}
  <div class="flex flex-col gap-0.5">
    {@render rowList(listRows)}
  </div>
{/if}

{#if !loading && hasDelegatedBin}
  <!-- Workspace-level Delegated bin (lazy-bin mode only): renders from
       `scopeCounts.delegated` while collapsed; expanding lazy-loads the delegated
       rows, which then nest under their parents in the tree above. -->
  <div class="container w-full min-w-0 pt-2">
    <Button
      variant="ghost-light"
      size="sm"
      class="h-9 w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-normal hover:bg-transparent active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-0"
      onclick={toggleDelegatedBin}
      aria-expanded={showDelegatedAgents}
      data-agent-delegated-toggle
    >
      <span class="min-w-0 flex-1 truncate text-left">
        {#if !showDelegatedAgents && runningDelegatedCount > 0}
          {m.workspace_agentsList_delegatedAgentsRunning_label({
            running: formatInteger(runningDelegatedCount),
            total: formatInteger(displayedDelegatedCount),
          })}
        {:else}
          {m.workspace_agentsList_delegatedAgents_label({
            count: formatInteger(displayedDelegatedCount),
          })}
        {/if}
      </span>
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto shrink-0 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {showDelegatedAgents
          ? ''
          : 'rotate-90'}"
      />
    </Button>
  </div>

  {#if showDelegatedSkeleton}
    <div class="space-y-2 py-2" data-agent-delegated-loading>
      {#each [1, 2] as { }}
        <div class="flex h-10 items-center gap-2 rounded-md px-2">
          <Skeleton class="size-6 shrink-0 rounded-md" />
          <Skeleton class="h-3.5 w-24" />
        </div>
      {/each}
    </div>
  {:else if delegatedRowsVisible && delegatedSectionAgents.length > 0}
    <!-- Delegated rows whose parent is not rendered (Background parent not
         loaded or its bin collapsed, or a retired parent) list here so the bin
         still holds them; while the parent row renders they nest under it. -->
    <div class="flex flex-col gap-0.5 pt-1" data-agent-delegated-section>
      {@render rowList(delegatedSectionRows)}
    </div>
  {/if}
{/if}

{#if !loading && hasBackgroundBin}
  <div class="container w-full min-w-0 pt-2">
    <Button
      variant="ghost-light"
      size="sm"
      class="h-9 w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-normal hover:bg-transparent active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-0"
      onclick={toggleBackgroundBin}
      aria-expanded={showBackgroundAgents}
      data-agent-background-toggle
    >
      <span class="min-w-0 flex-1 truncate text-left">
        {#if !showBackgroundAgents && runningBackgroundCount > 0}
          {m.workspace_agentsList_backgroundAgentsRunning_label({
            running: formatInteger(runningBackgroundCount),
            total: formatInteger(displayedBackgroundCount),
          })}
        {:else}
          {m.workspace_agentsList_backgroundAgents_label({
            count: formatInteger(displayedBackgroundCount),
          })}
        {/if}
      </span>
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto shrink-0 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {showBackgroundAgents
          ? ''
          : 'rotate-90'}"
      />
    </Button>
  </div>

  {#if showBackgroundSkeleton}
    <div class="space-y-2 py-2" data-agent-background-loading>
      {#each [1, 2] as { }}
        <div class="flex h-10 items-center gap-2 rounded-md px-2">
          <Skeleton class="size-6 shrink-0 rounded-md" />
          <Skeleton class="h-3.5 w-24" />
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex flex-col gap-0.5 pt-1">
    {#each standaloneBackgroundAgents as agent (agent.id)}
      {#if hasActiveSearch || showBackgroundAgents || isAgentRunning(agent.id)}
        <!-- Rendered through the shared rows so a background parent's
             delegated children nest under it (revealed by the Delegated bin). -->
        <div transition:slide={{ axis: 'y', tier: 'moderate' }}>
          {@render rowList(buildRows([agent]))}
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
      class="h-9 w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-normal hover:bg-transparent active:bg-transparent focus-visible:-outline-offset-2 focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-0"
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
        class="ml-auto shrink-0 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {showRetiredAgents
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
          <div transition:slide={{ axis: 'y', tier: 'moderate' }} class="opacity-70">
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

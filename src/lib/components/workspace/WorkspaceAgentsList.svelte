<script lang="ts">
  import type { AgentSession } from '$shared/types';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import { ListEmpty } from '$lib/components/ui/list';
  import VirtualList from '$lib/components/ui/VirtualList.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import {
    faChevronDown,
    faRobot,
    faSitemap,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { onMount } from 'svelte';
  import { getAvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import Header from '../ui/Header.svelte';
  import { getWorkspaceAgentsVisibilitySummary } from './workspace-agents-list-utils';

  interface Props {
    agents?: AgentSession[];
    selectedAgentId?: string | null;
    onSelect?: (detail: { agentId: string }) => void;
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    onOpenAgentOverview?: () => void;
    useVirtualScrolling?: boolean;
    loading?: boolean;
  }

  let {
    agents = [],
    selectedAgentId = null,
    onSelect,
    onCreate,
    onCreateWithSpecialist,
    onOpenAgentOverview,
    useVirtualScrolling = true,
    loading = false,
  }: Props = $props();

  // Toggle to show/hide background agents (default to false - hide them)
  let showBackgroundAgents = $state(false);

  // Track which delegator agents have their delegated children expanded (collapsed by default)
  let expandedDelegations = $state(new Set<string>());

  function toggleDelegation(agentId: string) {
    const next = new Set(expandedDelegations);
    if (next.has(agentId)) {
      next.delete(agentId);
    } else {
      next.add(agentId);
    }
    expandedDelegations = next;
  }

  // Track streaming state changes for reactivity
  let activeStreamsVersion = $state(0);

  onMount(() => {
    // Start polling for active streams and subscribe to changes
    activeStreamsTracker.startPolling();
    const unsubscribe = activeStreamsTracker.subscribe(() => {
      activeStreamsVersion++;
    });
    return () => {
      unsubscribe();
    };
  });

  // Helper to check if an agent is currently streaming (real-time check)
  function isAgentRunning(agentId: string): boolean {
    // Reference activeStreamsVersion for reactivity
    activeStreamsVersion;
    return activeStreamsTracker.isAgentStreaming(agentId);
  }

  // Helper to check if an agent is a background agent
  function isBackgroundAgent(agent: AgentSession): boolean {
    return !!(agent.isBackground || agent.metadata?.isBackground);
  }

  // Helper to get specialist ID for an agent
  function getAgentSpecialistId(
    agent: AgentSession,
  ): 'spec-writer' | 'implementor' | 'verifier' | 'ui-designer' | null {
    const specialistId = agent.metadata?.specialist || agent.agentMetadata?.specialist;
    // Only return if it's one of the known specialist types, otherwise null
    if (
      specialistId === 'spec-writer' ||
      specialistId === 'implementor' ||
      specialistId === 'verifier' ||
      specialistId === 'ui-designer'
    ) {
      return specialistId;
    }
    return null;
  }

  // Helper to get avatar state for an agent
  function getAgentAvatarState(agent: AgentSession) {
    const isRunning = isAgentRunning(agent.id) || agent.isStreaming || agent.isProcessing;
    return getAvatarState({
      isStreaming: isRunning,
      status: agent.status,
    });
  }

  // Dedupe agents by ID to avoid duplicate key errors
  const dedupedAgents = $derived.by(() => {
    const agentList = Array.isArray(agents) ? agents : [];
    const seen = new Set<string>();
    const result: AgentSession[] = [];
    for (const a of agentList) {
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        result.push(a);
      }
    }
    return result;
  });

  // Map of parent agent ID → delegated child agents (via createdByAgentId only, not forks)
  const delegationMap = $derived.by(() => {
    const agentIds = new Set<string>(dedupedAgents.map((a) => a.id));
    const map = new Map<string, AgentSession[]>();

    for (const agent of dedupedAgents) {
      const parentId =
        typeof agent.metadata?.createdByAgentId === 'string'
          ? agent.metadata.createdByAgentId
          : undefined;
      if (parentId && agentIds.has(parentId)) {
        if (!map.has(parentId)) map.set(parentId, []);
        map.get(parentId)!.push(agent);
      }
    }

    // Sort each group by creation time
    for (const children of map.values()) {
      children.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
    }
    return map;
  });

  // IDs of all agents that are nested under a parent (removed from top-level lists)
  const delegatedAgentIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const children of delegationMap.values()) {
      for (const child of children) {
        ids.add(child.id);
      }
    }
    return ids;
  });

  // Get delegated children for a given agent
  function getDelegatedChildren(agentId: string): AgentSession[] {
    return delegationMap.get(agentId) || [];
  }

  // Helper to check if an agent is the coordinator (initial spec-writer agent)

  // Top-level foreground agents: not background, not delegated under another agent
  // Coordinator agent is always sorted first
  const topLevelForegroundAgents = $derived.by(() => {
    return dedupedAgents
      .filter((a) => !isBackgroundAgent(a) && !delegatedAgentIds.has(a.id))
      .sort((a, b) => {
        // Spec-writer coordinator always first
        const aCoord = getAgentSpecialistId(a) === 'spec-writer';
        const bCoord = getAgentSpecialistId(b) === 'spec-writer';
        if (aCoord && !bCoord) return -1;
        if (!aCoord && bCoord) return 1;
        // Then by creation time
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
  });

  // Background agents that are NOT delegated (delegated ones appear under their parent)
  const standaloneBackgroundAgents = $derived.by(() => {
    return dedupedAgents
      .filter((a) => isBackgroundAgent(a) && !delegatedAgentIds.has(a.id))
      .sort((a, b) => {
        const aTime = a.updatedAt
          ? new Date(a.updatedAt).getTime()
          : a.lastActivity
            ? new Date(a.lastActivity).getTime()
            : 0;
        const bTime = b.updatedAt
          ? new Date(b.updatedAt).getTime()
          : b.lastActivity
            ? new Date(b.lastActivity).getTime()
            : 0;
        return bTime - aTime;
      });
  });

  let standaloneBackgroundCount = $derived(standaloneBackgroundAgents.length);

  // Count running standalone background agents
  let runningStandaloneBackgroundCount = $derived.by(() => {
    activeStreamsVersion;
    return standaloneBackgroundAgents.filter(
      (a) => isAgentRunning(a.id) || a.isStreaming || a.isProcessing,
    ).length;
  });

  // Whether the workspace has a coordinator agent (must be a spec-writer specialist)
  const hasCoordinator = $derived(
    topLevelForegroundAgents.some((a) => getAgentSpecialistId(a) === 'spec-writer'),
  );

  // Fall back to regular list when delegations exist (tree heights are variable)
  const shouldUseVirtual = $derived(
    useVirtualScrolling && topLevelForegroundAgents.length > 20 && delegationMap.size === 0,
  );
  const visibilitySummary = $derived(getWorkspaceAgentsVisibilitySummary(dedupedAgents));
  const shouldShowVisibilitySummary = $derived(
    visibilitySummary.totalCount > 0 &&
      (visibilitySummary.delegatedCount > 0 || visibilitySummary.backgroundCount > 0),
  );
  const itemHeight = 72;
  const containerHeight = 600;

  function handleAgentClick(agentId: string) {
    onSelect?.({ agentId });
  }
</script>

<!-- New Agent Row -->
{#if onCreate || onCreateWithSpecialist}
  <div class="px-3 mt-0.5">
    <CreateAgentSection {onCreate} {onCreateWithSpecialist} />
  </div>
{/if}

{#if !loading && shouldShowVisibilitySummary}
  <div class="px-3 pb-2 pt-0.5">
    <p class="text-xs text-subtle">
      Showing {visibilitySummary.topLevelForegroundCount} top-level of {visibilitySummary.totalCount}
      total
      {#if visibilitySummary.delegatedCount > 0}
        · {visibilitySummary.delegatedCount} delegated
      {/if}
      {#if visibilitySummary.backgroundCount > 0}
        · {visibilitySummary.backgroundCount} background
      {/if}
    </p>
  </div>
{/if}

<!-- Recursive snippet: renders an agent card + collapsible delegated children -->
{#snippet agentTree(agentList: AgentSession[], depth: number, showCoordinatorBanner?: boolean)}
  {#each agentList as agent, i (agent.id)}
    {#if showCoordinatorBanner && i === 0 && getAgentSpecialistId(agent) === 'spec-writer'}
      <div class="pt-1 pb-0.5">
        <Header size={6}>Coordinator</Header>
      </div>
    {/if}

    <!-- Section header before the first non-coordinator agent when a coordinator exists -->
    {#if showCoordinatorBanner && hasCoordinator && getAgentSpecialistId(agent) !== 'spec-writer' && depth === 0}
      {@const isFirstNonCoordinator = agentList
        .slice(0, i)
        .every((a) => getAgentSpecialistId(a) === 'spec-writer')}
      {#if isFirstNonCoordinator}
        <div class="pt-2.5 pb-0.5">
          <Header size={6}>Your Agents</Header>
          <p class="text-xs text-subtle mt-0.5">
            The Coordinator can delegate and verify tasks for these agents
          </p>
        </div>
      {/if}
    {/if}

    <AgentCard
      agentId={agent.id}
      agentName={agent.name}
      isBackground={isBackgroundAgent(agent)}
      selected={agent.id === selectedAgentId}
      {depth}
      onclick={() => handleAgentClick(agent.id)}
    />

    <!-- Delegated children section (collapsed by default) -->
    {@const children = getDelegatedChildren(agent.id)}
    {#if children.length > 0}
      {@const isExpanded = expandedDelegations.has(agent.id)}
      <div style="padding-left: {(depth + 1) * 26}px;" class="mb-2">
        <!-- Toggle row: avatars preview + count + chevron -->
        <button
          type="button"
          class="delegation-toggle container w-full flex items-center gap-2 py-1 pl-1.75 pr-3
            text-sm text-muted-foreground hover:text-muted-foreground/80 transition-colors cursor-pointer"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            toggleDelegation(agent.id);
          }}
        >
          {#if !isExpanded}
            <div class="flex items-center shrink-0 mr-1">
              {#each children.slice(0, 4) as child (child.id)}
                <div class="avatar -mr-1.5 flex flex-col">
                  <AugieAvatarWithState
                    agentId={child.id}
                    state={getAgentAvatarState(child)}
                    specialist={getAgentSpecialistId(child)}
                    size={20}
                  />
                </div>
              {/each}
            </div>
          {/if}
          <span class="truncate text-left">
            {children.length} delegated
          </span>
          <Fa
            icon={faChevronDown}
            size="xs"
            class="ml-auto shrink-0 transition-transform duration-200 opacity-50 {isExpanded
              ? ''
              : 'rotate-90'}"
          />
        </button>

        <!-- Expanded: show delegated agent cards (flush with toggle) -->
        {#if isExpanded}
          <div class="flex flex-col gap-0.5" transition:slide={{ axis: 'y', duration: 150 }}>
            {@render agentTree(children, 0)}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

{#if loading}
  <!-- Skeleton loader while agents are loading -->
  <div class="space-y-2 px-3 py-2">
    {#each [1, 2, 3] as { }}
      <div class="flex items-center gap-3 py-2 px-2 rounded-md bg-muted/20">
        <Skeleton class="h-4 w-4 rounded-full shrink-0" />
        <div class="flex-1 space-y-1.5">
          <Skeleton class="h-3.5 w-24" />
          <Skeleton class="h-2.5 w-16" />
        </div>
      </div>
    {/each}
  </div>
{:else if topLevelForegroundAgents.length === 0 && standaloneBackgroundCount === 0}
  <ListEmpty message="No agents yet" icon={faRobot} />
{:else if shouldUseVirtual}
  <!-- Virtual scrolling fallback (flat, no delegations) -->
  <div class="h-full max-h-150 overflow-hidden pl-2">
    <VirtualList
      items={topLevelForegroundAgents}
      {itemHeight}
      {containerHeight}
      getKey={(agent: AgentSession) => agent.id}
    >
      {#snippet children({ item: agent }: { item: AgentSession })}
        <AgentCard
          agentId={agent.id}
          agentName={agent.name}
          isBackground={false}
          selected={agent.id === selectedAgentId}
          depth={0}
          onclick={() => handleAgentClick(agent.id)}
        />
      {/snippet}
    </VirtualList>
  </div>
{:else}
  <!-- Tree list for foreground agents with collapsible delegated children -->
  <div class="flex flex-col gap-0.5 pl-2">
    {@render agentTree(topLevelForegroundAgents, 0, true)}
  </div>
{/if}

<!-- Standalone background agents toggle (at bottom) -->
{#if standaloneBackgroundCount > 0}
  <div class="container w-full min-w-0 px-1.5 pt-2">
    <Button
      variant="ghost-light"
      size="sm"
      class="w-full min-w-0 text-sm gap-1.5"
      onclick={() => (showBackgroundAgents = !showBackgroundAgents)}
    >
      {#if !showBackgroundAgents}
        <!-- Avatar row preview when collapsed -->
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <div class="flex items-center shrink-0">
            {#each standaloneBackgroundAgents.slice(0, 5) as agent (agent.id)}
              {@const state = getAgentAvatarState(agent)}
              {@const specialist = getAgentSpecialistId(agent)}
              <div class="avatar -mr-1.5">
                <AugieAvatarWithState agentId={agent.id} {state} {specialist} size={16} />
              </div>
            {/each}
          </div>
          <span class="truncate flex-1 min-w-0 text-left">
            {#if runningStandaloneBackgroundCount > 0}
              {runningStandaloneBackgroundCount} / {standaloneBackgroundCount} background agents running
            {:else}
              {standaloneBackgroundCount} background agents
            {/if}
          </span>
        </div>
      {:else}
        <span>{standaloneBackgroundCount} background agents</span>
      {/if}
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto transition-transform duration-200 {showBackgroundAgents ? 'rotate-180' : ''}"
      />
    </Button>
  </div>

  <!-- Background agents list: show all when expanded, only running when collapsed -->
  <div class="flex flex-col gap-0.5 pl-2 pt-1">
    {#each standaloneBackgroundAgents as agent (agent.id)}
      {@const isRunning = isAgentRunning(agent.id) || agent.isStreaming || agent.isProcessing}
      {#if showBackgroundAgents || isRunning}
        <div class="w-full" transition:slide={{ axis: 'y', duration: 150 }}>
          <AgentCard
            agentId={agent.id}
            agentName={agent.name}
            isBackground={true}
            selected={agent.id === selectedAgentId}
            depth={0}
            onclick={() => handleAgentClick(agent.id)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if onOpenAgentOverview && agents.length > 1}
  <div class="px-1.5 pt-2">
    <button
      type="button"
      class="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-subtle hover:text-muted-foreground hover:bg-muted/50 rounded-md transition-colors cursor-pointer"
      onclick={() => onOpenAgentOverview?.()}
    >
      <Fa icon={faSitemap} size="xs" class="opacity-50" />
      <span>View agent tree</span>
    </button>
  </div>
{/if}

<style>
  .container {
    container-type: inline-size;
  }

  /* down to <3 agents */
  @container (max-width: 230px) {
    .avatar:nth-child(n + 4) {
      display: none;
    }
  }

  /* down to <2 agents */
  @container (max-width: 210px) {
    .avatar:nth-child(n + 3) {
      display: none;
    }
  }
  /* down to <1 agents */
  @container (max-width: 100px) {
    .avatar:nth-child(n + 2) {
      display: none;
    }
  }
</style>

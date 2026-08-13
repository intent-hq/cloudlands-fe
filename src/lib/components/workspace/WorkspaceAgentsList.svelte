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
  import AugieAvatarWithState from '$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/auggie-avatar/avatar-state';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import {
    getFlatWorkspaceAgentRows,
    isBackgroundAgentSession as isBackgroundAgent,
    shouldVirtualizeWorkspaceAgentRows,
  } from './workspace-agents-list-utils';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    agents?: AgentSession[];
    selectedAgentId?: string | null;
    onSelect?: (detail: { agentId: string }) => void;
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    runningAgentIds?: string[];
    loading?: boolean;
  }

  let {
    agents = [],
    selectedAgentId = null,
    onSelect,
    onCreate,
    onCreateWithSpecialist,
    runningAgentIds = [],
    loading = false,
  }: Props = $props();

  const flatAgentRows = $derived(getFlatWorkspaceAgentRows(agents));
  const runningAgentIdSet = $derived(new Set(runningAgentIds));
  const directChildrenByAgentId = $derived.by(() => {
    const children = new Map<string, AgentSession[]>();
    const ancestors: { id: string; depth: number }[] = [];

    for (const row of flatAgentRows) {
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
    flatAgentRows.filter((row) => row.depth === 0).map((row) => row.agent),
  );
  const topLevelForegroundAgents = $derived(
    topLevelAgents.filter((agent) => !isBackgroundAgent(agent)),
  );
  const standaloneBackgroundAgents = $derived(
    topLevelAgents.filter((agent) => isBackgroundAgent(agent)),
  );
  const hasCoordinator = $derived(topLevelForegroundAgents.some(isCoordinator));
  // Fall back to the regular list when delegations exist (tree heights are variable).
  const shouldUseVirtual = $derived(shouldVirtualizeWorkspaceAgentRows(flatAgentRows));
  // Matches the slim card's base height (LazyAgentCard's estimatedHeight default);
  // virtualized rows hide the preview line so every row stays uniform.
  const itemHeight = 48;
  const containerHeight = 600;
  let expandedAgentIds = $state(new Set<string>());
  let showBackgroundAgents = $state(false);
  const runningBackgroundCount = $derived(
    standaloneBackgroundAgents.filter((agent) => isAgentRunning(agent.id)).length,
  );

  function isCoordinator(agent: AgentSession): boolean {
    return (agent.metadata?.specialist ?? agent.agentMetadata?.specialist) === 'spec-writer';
  }

  function isAgentRunning(agentId: string): boolean {
    return runningAgentIdSet.has(agentId);
  }

  function getSpecialist(agent: AgentSession): BuiltinSpecialistId | undefined {
    return (agent.metadata?.specialist ?? agent.agentMetadata?.specialist) as
      BuiltinSpecialistId | undefined;
  }

  function getAgentAvatarState(agent: AgentSession) {
    return getAvatarState({
      isStreaming: isAgentRunning(agent.id),
      status: agent.status,
    });
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
</script>

{#snippet agentTree(agentList: AgentSession[])}
  {#each agentList as agent (agent.id)}
    <LazyAgentCard
      cacheKey={agent.id}
      agentId={agent.id}
      agentName={agent.name}
      isBackground={isBackgroundAgent(agent)}
      selected={agent.id === selectedAgentId}
      onclick={() => handleAgentClick(agent.id)}
    />

    {@const children = directChildrenByAgentId.get(agent.id) ?? []}
    {#if children.length > 0}
      {@const isExpanded = expandedAgentIds.has(agent.id)}
      {@const runningChildren = children.filter((child) => isAgentRunning(child.id))}
      <div class="mb-2" style="padding-left: 26px;">
        <Button
          variant="ghost-light"
          size="sm"
          class="container flex w-full cursor-pointer items-center gap-2 py-1 pr-3 pl-1.75 text-sm text-muted-foreground transition-colors hover:text-foreground"
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
          {#if !isExpanded}
            <div class="mr-1 flex shrink-0 items-center">
              {#each children.slice(0, 4) as child (child.id)}
                <div class="avatar -mr-1.5 flex">
                  <AugieAvatarWithState
                    agentId={child.id}
                    state={getAgentAvatarState(child)}
                    specialist={getSpecialist(child)}
                    size={20}
                  />
                </div>
              {/each}
            </div>
          {/if}
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
              : '-rotate-90'}"
          />
        </Button>

        {#if isExpanded}
          <div class="flex flex-col gap-0.5" transition:slide={{ axis: 'y', duration: 150 }}>
            {@render agentTree(children)}
          </div>
        {:else if runningChildren.length > 0}
          <div class="flex flex-col gap-0.5">
            {#each runningChildren as child (child.id)}
              <div transition:slide={{ axis: 'y', duration: 150 }}>
                <LazyAgentCard
                  cacheKey={child.id}
                  agentId={child.id}
                  agentName={child.name}
                  isBackground={isBackgroundAgent(child)}
                  selected={child.id === selectedAgentId}
                  onclick={() => handleAgentClick(child.id)}
                />
              </div>
            {/each}
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
      <div class="flex items-center gap-3 py-2 px-2 rounded-md bg-muted/20">
        <Skeleton class="h-4 w-4 rounded-full shrink-0" />
        <div class="flex-1 space-y-1.5">
          <Skeleton class="h-3.5 w-24" />
          <Skeleton class="h-2.5 w-16" />
        </div>
      </div>
    {/each}
  </div>
{:else if topLevelForegroundAgents.length === 0 && standaloneBackgroundAgents.length === 0}
  <ListEmpty message={m.workspace_agentsList_empty_label()} />
{:else if shouldUseVirtual}
  <!-- Virtual scrolling fallback (flat, no delegations) -->
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
            hidePreview
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
            <p class="mt-0.5 text-xs text-subtle">
              {m.workspace_overviewTimeline_coordinatorDelegates_description()}
            </p>
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
      class="w-full min-w-0 gap-1.5 text-sm"
      onclick={() => (showBackgroundAgents = !showBackgroundAgents)}
      aria-expanded={showBackgroundAgents}
    >
      {#if !showBackgroundAgents}
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="flex shrink-0 items-center">
            {#each standaloneBackgroundAgents.slice(0, 5) as agent (agent.id)}
              <div class="avatar -mr-1.5 flex">
                <AugieAvatarWithState
                  agentId={agent.id}
                  state={getAgentAvatarState(agent)}
                  specialist={getSpecialist(agent)}
                  size={16}
                />
              </div>
            {/each}
          </div>
          <span class="min-w-0 flex-1 truncate text-left">
            {#if runningBackgroundCount > 0}
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
        </div>
      {:else}
        <span>
          {m.workspace_agentsList_backgroundAgents_label({
            count: formatInteger(standaloneBackgroundAgents.length),
          })}
        </span>
      {/if}
      <Fa
        icon={faChevronDown}
        size="xs"
        class="ml-auto shrink-0 transition-transform duration-200 {showBackgroundAgents
          ? 'rotate-180'
          : ''}"
      />
    </Button>
  </div>

  <div class="flex flex-col gap-0.5 pt-1">
    {#each standaloneBackgroundAgents as agent (agent.id)}
      {#if showBackgroundAgents || isAgentRunning(agent.id)}
        <div transition:slide={{ axis: 'y', duration: 150 }}>
          <LazyAgentCard
            cacheKey={agent.id}
            agentId={agent.id}
            agentName={agent.name}
            isBackground
            selected={agent.id === selectedAgentId}
            onclick={() => handleAgentClick(agent.id)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .container {
    container-type: inline-size;
  }

  @container (max-width: 230px) {
    .avatar:nth-child(n + 4) {
      display: none;
    }
  }
</style>

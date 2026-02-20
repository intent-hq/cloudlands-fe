<script lang="ts">
  /**
   * Background Agents Popup
   *
   * Displays a list of background agents in a popup/dropdown.
   * Shows agent summaries and allows selecting/viewing background agents.
   */

  import { faRobot, faPlus, faSearch, faFilter } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import AgentSummaryCard from './AgentSummaryCard.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { AgentSession } from '$shared/types';
  import { cn } from '$lib/utils';
  import { fly, fade } from 'svelte/transition';
  import { clickOutside } from '$lib/actions/click-outside';

  interface Props {
    agents: AgentSession[];
    onSelectAgent?: (agentId: string) => void;
    onCreateAgent?: (type: string) => void;
    onClose?: () => void;
    position?: 'left' | 'right' | 'center';
    className?: string;
  }

  let {
    agents,
    onSelectAgent,
    onCreateAgent,
    onClose,
    position = 'left',
    className = '',
  }: Props = $props();

  let searchQuery = $state('');
  let filterType = $state<string | null>(null);

  // Get unique trigger types for filtering
  let triggerTypes = $derived([
    ...new Set(agents.map((a) => a.metadata?.triggerType).filter(Boolean)),
  ]);

  // Dedupe agents by ID
  let dedupedAgents = $derived.by(() => {
    const seen = new Set<string>();
    const result: AgentSession[] = [];
    for (const a of agents) {
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        result.push(a);
      }
    }
    return result;
  });

  // Filter agents based on search and filter
  let filteredAgents = $derived.by(() => {
    let filtered = dedupedAgents;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.metadata?.triggerType?.toLowerCase().includes(query) ||
          agent.metadata?.agentType?.toLowerCase().includes(query),
      );
    }

    // Apply type filter
    if (filterType) {
      filtered = filtered.filter((agent) => agent.metadata?.triggerType === filterType);
    }

    return filtered;
  });

  // Group agents by trigger type
  let groupedAgents = $derived.by(() => {
    const groups: Record<string, AgentSession[]> = {};

    filteredAgents.forEach((agent) => {
      const type = agent.metadata?.triggerType || 'other';
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(agent);
    });

    return groups;
  });

  // Available background agent types for creation
  const backgroundAgentTypes = [
    { id: 'commit', label: 'Commit Message', icon: faRobot },
    { id: 'pr', label: 'PR Description', icon: faRobot },
    { id: 'review', label: 'Code Review', icon: faRobot },
  ];

  function handleSelectAgent(agentId: string) {
    onSelectAgent?.(agentId);
    onClose?.();
  }

  function handleCreateAgent(type: string) {
    onCreateAgent?.(type);
    onClose?.();
  }

  // Handle escape key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose?.();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class={cn(
    'absolute z-50 mt-2 w-96 max-h-[600px] overflow-hidden',
    'bg-popover border rounded-lg shadow-lg',
    position === 'left' && 'left-0',
    position === 'right' && 'right-0',
    position === 'center' && 'left-1/2 -translate-x-1/2',
    className,
  )}
  transition:fly={{ y: -10, duration: 200 }}
  use:clickOutside={onClose || (() => {})}
>
  <!-- Header -->
  <div class="sticky top-0 z-10 bg-popover border-b px-4 py-3">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-sm flex items-center gap-2">
        <Fa icon={faRobot} class="text-muted-foreground" />
        Background Agents
      </h3>
      <span class="text-xs text-muted-foreground">
        {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''}
      </span>
    </div>

    <!-- Search and Filter -->
    <div class="flex gap-2">
      <div class="flex-1 relative">
        <Fa
          icon={faSearch}
          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          size="xs"
        />
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search agents..."
          class="w-full pl-8 pr-3 py-1.5 text-xs bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {#if triggerTypes.length > 0}
        <select
          bind:value={filterType}
          class="px-3 py-1.5 text-xs bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value={null}>All Types</option>
          {#each triggerTypes as type (type)}
            <option value={type}>{type}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="overflow-y-auto max-h-[400px] p-2">
    {#if filteredAgents.length === 0}
      <div class="py-8 text-center">
        <Fa icon={faRobot} class="text-muted-foreground mb-3" size="2x" />
        <p class="text-sm text-muted-foreground mb-1">
          {searchQuery ? 'No agents found' : 'No background agents yet'}
        </p>
        <p class="text-xs text-muted-foreground mb-4">
          Background agents run automatically for specific tasks
        </p>
      </div>
    {:else}
      <!-- Group by trigger type -->
      {#each Object.entries(groupedAgents) as [type, typeAgents] (type)}
        <div class="mb-4">
          <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            {type}
          </h4>
          <div class="space-y-2">
            {#each typeAgents as agent (agent.id)}
              <AgentSummaryCard
                {agent}
                variant="compact"
                onClick={() => handleSelectAgent(agent.id)}
                className="mx-1"
              />
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Footer with Create Options -->
  <div class="sticky bottom-0 bg-popover border-t px-4 py-3">
    <div class="text-xs text-muted-foreground mb-2">Create Background Agent</div>
    <div class="grid grid-cols-3 gap-2">
      {#each backgroundAgentTypes as type (type.id)}
        <Button
          size="sm"
          variant="ghost"
          onclick={() => handleCreateAgent(type.id)}
          class="flex flex-col items-center gap-1 py-2"
        >
          <Fa icon={type.icon} size="sm" />
          <span class="text-xs">{type.label}</span>
        </Button>
      {/each}
    </div>
  </div>
</div>

<style>
  /* Custom scrollbar for the popup */
  .overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }

  .overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: var(--color-border);
    border-radius: 3px;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-muted-foreground);
  }
</style>

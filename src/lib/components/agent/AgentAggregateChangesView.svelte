<script lang="ts">
  /**
   * Agent Aggregate Changes View
   *
   * Shows aggregated changes across multiple agent turns or sessions.
   * Provides a comprehensive view of all modifications with filtering and grouping.
   */

  import {
    faLayerGroup,
    faFilter,
    faChevronDown,
    faChevronRight,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('AgentAggregateChangesView');

  interface Props {
    agentId?: string;
    sessionId?: string;
    startTurn?: number;
    endTurn?: number;
    workspaceId: string;
    onFileClick?: (file: string) => void;
    onShowDiff?: (change: TrackedChange) => void;
  }

  let { agentId, sessionId, startTurn, endTurn, workspaceId, onFileClick, onShowDiff }: Props =
    $props();

  // State
  let groupBy: 'file' | 'turn' | 'none' = $state('file');
  let showOnlyModified = $state(false);
  let expandedGroups = $state(new Set<string>());
  let changes: TrackedChange[] = $state([]);
  let isLoading = $state(true);
  let error: string | null = $state(null);

  // Load changes
  $effect(() => {
    if (agentId && sessionId) {
      loadChanges();
    } else {
      isLoading = false;
      changes = [];
    }
  });

  async function loadChanges() {
    isLoading = true;
    error = null;
    try {
      if (!agentId || !sessionId) {
        changes = [];
        return;
      }

      changes = await fileTrackingStore.getAgentChanges(agentId, sessionId);

      // Filter by turn range if specified
      if (startTurn !== undefined || endTurn !== undefined) {
        changes = changes.filter((c) => {
          const turn = c.attribution.agent?.turnNumber || 0;
          if (startTurn !== undefined && turn < startTurn) return false;
          if (endTurn !== undefined && turn > endTurn) return false;
          return true;
        });
      }

      // Apply modified filter
      if (showOnlyModified) {
        changes = changes.filter(
          (c) => c.stats && (c.stats.additions > 0 || c.stats.deletions > 0),
        );
      }
    } catch (err) {
      logger.error('Failed to load agent changes:', err);
      error = 'Failed to load changes';
      changes = [];
    } finally {
      isLoading = false;
    }
  }

  // Group changes
  let groupedChanges = $derived.by(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'All Changes', changes }];
    }

    const groups = new Map<string, TrackedChange[]>();

    changes.forEach((change) => {
      const key =
        groupBy === 'file' ? change.file : `turn-${change.attribution.agent?.turnNumber || 0}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(change);
    });

    return Array.from(groups.entries()).map(([key, changes]) => ({
      key,
      label: groupBy === 'file' ? key.split('/').pop() || key : `Turn ${key.split('-')[1]}`,
      changes,
    }));
  });

  // Calculate totals
  let totalFiles = $derived(new Set(changes.map((c) => c.file)).size);
  let totalAdditions = $derived(changes.reduce((sum, c) => sum + (c.stats?.additions || 0), 0));
  let totalDeletions = $derived(changes.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0));

  function toggleGroup(key: string) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
    }
    expandedGroups = new Set(expandedGroups);
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center justify-between p-4 border-b">
    <div class="flex items-center gap-2">
      <Fa icon={faLayerGroup} class="text-muted-foreground" />
      <h2 class="font-medium">Aggregate Changes</h2>
      {#if !isLoading}
        <span class="text-sm text-muted-foreground">
          ({totalFiles} file{totalFiles !== 1 ? 's' : ''})
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if !isLoading}
        <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="sm" />
      {/if}

      <!-- Filter Button -->
      <Button
        variant={showOnlyModified ? 'default' : 'ghost'}
        size="xs"
        onclick={() => {
          showOnlyModified = !showOnlyModified;
          loadChanges();
        }}
      >
        <Fa icon={faFilter} size="xs" />
        <span class="ml-1">Modified</span>
      </Button>

      <!-- Group By Selector -->
      <select bind:value={groupBy} class="text-xs px-2 py-1 rounded border bg-background">
        <option value="file">Group by File</option>
        <option value="turn">Group by Turn</option>
        <option value="none">No Grouping</option>
      </select>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    {#if isLoading}
      <div class="flex items-center justify-center h-32">
        <span class="text-muted-foreground">Loading changes...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-32 gap-2">
        <span class="text-red-500">{error}</span>
        <Button size="sm" variant="outline" onclick={loadChanges}>Retry</Button>
      </div>
    {:else if groupedChanges.length === 0}
      <div class="flex items-center justify-center h-32">
        <span class="text-muted-foreground">No changes found</span>
      </div>
    {:else}
      <div class="divide-y">
        {#each groupedChanges as group (group.key)}
          {@const isExpanded = expandedGroups.has(group.key) || groupBy === 'none'}
          {@const groupAdditions = group.changes.reduce(
            (sum, c) => sum + (c.stats?.additions || 0),
            0,
          )}
          {@const groupDeletions = group.changes.reduce(
            (sum, c) => sum + (c.stats?.deletions || 0),
            0,
          )}

          <div class="border-b last:border-b-0">
            {#if groupBy !== 'none'}
              <button
                class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                onclick={() => toggleGroup(group.key)}
              >
                <div class="flex items-center gap-2 min-w-0">
                  <Fa icon={isExpanded ? faChevronDown : faChevronRight} size="xs" />
                  <span class="font-medium text-sm truncate">{group.label}</span>
                  <span class="text-xs text-muted-foreground">({group.changes.length})</span>
                </div>
                <LineChangesBadge additions={groupAdditions} deletions={groupDeletions} size="xs" />
              </button>
            {/if}

            {#if isExpanded}
              <div class="divide-y">
                {#each group.changes as change (change.file)}
                  <button
                    class="w-full flex items-center justify-between p-3 pl-8 hover:bg-muted/50 transition-colors text-left"
                    onclick={() => onShowDiff?.(change)}
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <Fa icon={faPencil} size="xs" class="text-muted-foreground shrink-0" />
                      <span class="text-sm font-mono truncate">
                        {change.file.split('/').pop() || change.file}
                      </span>
                    </div>
                    <LineChangesBadge
                      additions={change.stats?.additions || 0}
                      deletions={change.stats?.deletions || 0}
                      size="xs"
                    />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

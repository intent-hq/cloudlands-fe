<script lang="ts">
  import type { TrackedChange } from '$features/file-tracking/types';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import FileChangesList from './FileChangesList.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faCodeBranch, faExpand, faPen } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    agentId: string;
    sessionId: string;
    turnNumber?: number;
  }

  let { agentId, sessionId, turnNumber }: Props = $props();

  let filterMode: 'all' | 'turn' = $state('all');
  let expandedTurns = $state(new Set<number>());

  // Get changes for this agent
  let agentChanges: TrackedChange[] = $state([]);

  $effect(() => {
    let destroyed = false;

    // Load changes asynchronously
    fileTrackingStore
      .getAgentChanges(agentId, sessionId, filterMode === 'turn' ? turnNumber : undefined)
      .then((changes) => {
        if (destroyed) return;
        agentChanges = changes;
      });

    return () => {
      destroyed = true;
    };
  });

  // Group changes by turn
  const changesByTurn = $derived.by(() => {
    const grouped = new Map<number, TrackedChange[]>();

    agentChanges.forEach((change) => {
      const turn = change.attribution.agent?.turnNumber || 0;
      if (!grouped.has(turn)) {
        grouped.set(turn, []);
      }
      grouped.get(turn)!.push(change);
    });

    return Array.from(grouped.entries()).sort((a, b) => b[0] - a[0]);
  });

  function handleExpandToMainPanel() {
    fileTrackingStore.setMainPanelView({
      type: 'agent',
      agentId,
      sessionId,
      turnNumber: filterMode === 'turn' ? turnNumber : undefined,
    });
  }
</script>

{#if agentChanges.length > 0}
  <div class="border-b border-border bg-muted/30">
    <div class="px-3 py-2">
      <!-- Header with filter toggle -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <Fa icon={faPen} size="xs" class="text-ghost" />
          <span class="text-sm font-medium">Code Changes</span>
          <span class="text-xs text-subtle">
            ({agentChanges.length}
            {agentChanges.length === 1 ? 'file' : 'files'})
          </span>
        </div>

        <div class="flex items-center gap-1">
          <Button
            variant={filterMode === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => (filterMode = 'all')}
            class="h-6 px-2 text-xs"
          >
            All Turns
          </Button>
          <Button
            variant={filterMode === 'turn' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => (filterMode = 'turn')}
            class="h-6 px-2 text-xs"
          >
            By Turn
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onclick={() => handleExpandToMainPanel()}
            class="h-6 w-6 p-0 ml-2"
          >
            <Fa icon={faExpand} size="xs" />
          </Button>
        </div>
      </div>

      <!-- Changes list -->
      {#if filterMode === 'all'}
        <!-- Show all changes in a flat/tree list -->
        <div class="max-h-48 overflow-y-auto">
          <FileChangesList
            changes={agentChanges}
            viewMode="list"
            showStats={true}
            showActions={true}
            onFileClick={(change) => {
              fileTrackingStore.setMainPanelView({
                type: 'agent',
                agentId,
                sessionId,
                changeId: change.id,
              });
            }}
            onExpandClick={(change) => {
              fileTrackingStore.setMainPanelView({
                type: 'agent',
                agentId,
                sessionId,
                changeId: change.id,
              });
            }}
          />
        </div>
      {:else}
        <!-- Show changes grouped by turn -->
        {#if changesByTurn.length > 0}
          <div class="max-h-48 overflow-y-auto space-y-1">
            {#each changesByTurn as [turn, changes] (turn)}
              <div class="border border-border rounded">
                <button
                  class="w-full flex items-center justify-between px-2 py-1 hover:bg-muted/50 text-left"
                  onclick={() => {
                    if (expandedTurns.has(turn)) {
                      expandedTurns.delete(turn);
                    } else {
                      expandedTurns.add(turn);
                    }
                    expandedTurns = new Set(expandedTurns);
                  }}
                >
                  <div class="flex items-center gap-2">
                    <i
                      class="fa fa-chevron-{expandedTurns.has(turn) ? 'down' : 'right'} text-xs w-3"
                    ></i>
                    <span class="text-sm">Turn {turn}</span>
                    <span class="text-xs text-subtle">
                      ({changes.length}
                      {changes.length === 1 ? 'file' : 'files'})
                    </span>
                  </div>
                </button>

                {#if expandedTurns.has(turn)}
                  <div class="border-t border-border">
                    <FileChangesList
                      {changes}
                      viewMode="list"
                      showStats={true}
                      showActions={false}
                    />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

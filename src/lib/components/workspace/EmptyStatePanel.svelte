<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Fa from 'svelte-fa';
  import {
    faFileAlt,
    faClock,
    faFile,
    faStickyNote,
    faCodeBranch,
    faArrowRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';

  interface NavigationItem {
    type: 'file' | 'note' | 'diff';
    id: string;
    title: string;
    timestamp: number;
  }

  interface Props {
    recentItems?: NavigationItem[];
    onNavigateToItem?: (item: NavigationItem) => void;
    onOpenSpec?: () => void;
    isLoading?: boolean;
  }

  let { recentItems = [], onNavigateToItem, onOpenSpec, isLoading = false }: Props = $props();
</script>

<div class="flex items-center justify-center h-full">
  {#if isLoading}
    <!-- Loading skeleton -->
    <div class="w-full max-w-md px-4 space-y-4">
      <div class="flex justify-center mb-6">
        <Skeleton class="w-16 h-16 rounded-lg" />
      </div>
      <Skeleton class="h-4 w-3/4 mx-auto" />
      <Skeleton class="h-4 w-1/2 mx-auto" />
      <div class="space-y-2 mt-6">
        <Skeleton class="h-3 w-1/3 mx-auto mb-4" />
        {#each [1, 2, 3] as _}
          <Skeleton class="h-10 w-full" />
        {/each}
      </div>
    </div>
  {:else}
    <div class="text-center space-y-4 max-w-md">
      <div class="text-subtle">
        <Fa icon={faFileAlt} class="mx-auto opacity-20 text-4xl" />
      </div>
      <p class="text-sm text-subtle">Select a note, file, or code change to view</p>

      {#if recentItems && recentItems.length > 0}
        <div class="mt-6">
          <h3
            class="text-xs font-medium text-subtle mb-3 flex items-center justify-center gap-2"
          >
            <Fa icon={faClock} size="xs" />
            Recent Items ({recentItems.length})
          </h3>
          <div class="space-y-1">
            {#each recentItems.slice(0, 5) as item (item.id || `item-${item.type}-${item.title}`)}
              <button
                class="w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 transition-colors flex items-center gap-2 group"
                onclick={() => onNavigateToItem?.(item)}
              >
                {#if item.type === 'file'}
                  <Fa icon={faFile} class="h-3 w-3 text-ghost" />
                {:else if item.type === 'note'}
                  <Fa icon={faNote} class="h-3 w-3 text-ghost" />
                {:else}
                  <Fa icon={faCodeBranch} class="h-3 w-3 text-ghost" />
                {/if}
                <span class="text-sm truncate flex-1">{item.title}</span>
                <Fa
                  icon={faArrowRight}
                  size="xs"
                  class="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <Button size="sm" variant="secondary" onclick={() => onOpenSpec?.()}>Open Spec</Button>
      {/if}
    </div>
  {/if}
</div>

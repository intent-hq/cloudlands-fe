<script lang="ts">
  import { cn } from '$lib/utils';
  import { fly } from 'svelte/transition';
  import type { Snippet } from 'svelte';

  interface Tab {
    id: string;
    label: string;
  }

  interface Props {
    tabs: Tab[];
    activeTab: string;
    onTabChange?: (tabId: string) => void;
    headerClass?: string;
    contentClass?: string;
    /** Content snippet - receives the active tab id */
    content?: Snippet<[string]>;
    /** Optional content for the right side of the header */
    headerRight?: Snippet;
    /** Content rendered above the scroll container - receives the active tab id */
    beforeScroll?: Snippet<[string]>;
  }

  let {
    tabs,
    activeTab = $bindable(),
    onTabChange,
    headerClass,
    contentClass,
    content,
    headerRight,
    beforeScroll,
  }: Props = $props();

  // Track previous tab for transition direction
  let previousTabIndex = $state(0);

  function handleTabClick(tabId: string) {
    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    previousTabIndex = currentIndex;
    activeTab = tabId;
    onTabChange?.(tabId);
  }

  // Get transition direction based on tab order
  function getTransitionX(): number {
    const tabIndex = tabs.findIndex((t) => t.id === activeTab);
    return tabIndex > previousTabIndex ? 20 : -20;
  }
</script>

<!-- Tab Headers -->
<div class={cn('shrink-0 px-4 pt-2 pb-1', headerClass)}>
  <div class="flex items-center gap-4">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class={cn(
          'text-ui uppercase tracking-wider font-medium transition-colors cursor-pointer whitespace-nowrap',
          activeTab === tab.id
            ? 'text-muted-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onclick={() => handleTabClick(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
    {#if headerRight}
      <div class="ml-auto">
        {@render headerRight()}
      </div>
    {/if}
  </div>
</div>

<!-- Before scroll content (outside scroll container) -->
{#if beforeScroll}
  <div class="shrink-0">
    {@render beforeScroll(activeTab)}
  </div>
{/if}

<!-- Tab Content -->
<div class={cn('overflow-y-auto overflow-x-hidden min-h-20 relative', contentClass)}>
  <!-- Top gradient fade -->
  <div
    class="pointer-events-none sticky top-0 left-0 right-0 h-3 -mb-3 bg-linear-to-b from-sidebar to-transparent z-10"
  ></div>

  {#if content}
    {#key activeTab}
      <div
        class="transition-all duration-200 pt-1 pb-3"
        in:fly={{ x: getTransitionX(), duration: 200 }}
      >
        {@render content(activeTab)}
      </div>
    {/key}
  {/if}

  <!-- Bottom gradient fade -->
  <div
    class="pointer-events-none sticky -bottom-px left-0 right-0 h-6 -mt-6 bg-linear-to-t from-sidebar to-transparent z-10"
  ></div>
</div>

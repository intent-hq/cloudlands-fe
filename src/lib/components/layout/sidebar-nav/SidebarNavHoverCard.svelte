<script lang="ts">
  /**
   * SidebarNavHoverCard - Popup card that appears when hovering sidebar nav items
   *
   * Positioned to the right of the hovered icon, shows preview content
   * for each nav item type.
   *
   * Focus management: steals focus when the card appears so keyboard navigation
   * works immediately, and restores focus to the previously focused element on close.
   */

  import { tick } from 'svelte';
  import { sidebarNavStore, type SidebarNavItem } from './sidebar-nav.store.svelte';
  import NewWorkspaceCard from './cards/NewWorkspaceCard.svelte';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import { fly } from 'svelte/transition';

  const cardMeta: Partial<Record<SidebarNavItem, { title: string; description: string }>> = {
    'new-workspace': { title: 'Create new workspace', description: '' },
    active: { title: 'Active workspaces', description: '' },
    'all-workspaces': { title: 'All workspaces', description: '' },
  };

  interface Props {
    iconRefs: Record<string, HTMLButtonElement | null>;
  }

  let { iconRefs }: Props = $props();

  const activeCard = $derived(sidebarNavStore.activeCard);
  const isExpanded = $derived(sidebarNavStore.expandedItem !== null);
  const meta = $derived(activeCard ? cardMeta[activeCard] : null);

  // Focus management: save/restore focus when card opens/closes
  let previouslyFocused: HTMLElement | null = null;
  let contentEl: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (activeCard) {
      // Card is opening — save current focus and move it into the card
      previouslyFocused = document.activeElement as HTMLElement | null;
      tick().then(() => {
        // Focus the first focusable child (the listbox container or search input)
        const focusable = contentEl?.querySelector<HTMLElement>('[tabindex="0"], input, button');
        focusable?.focus();
      });
    } else {
      // Card is closing — restore focus
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    }
  });

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sidebarNavStore.closeHoverCards();
    }
  }

  // Calculate card position based on the hovered icon
  const cardStyle = $derived.by(() => {
    if (!activeCard) return '';
    const ref = iconRefs[activeCard];
    if (!ref) return 'top: 48px; left: 60px;';

    const rect = ref.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const padding = 8;

    // If the button is in the bottom half, anchor card bottom to button bottom
    if (rect.bottom > viewportHeight / 2) {
      return `bottom: ${viewportHeight - rect.bottom - padding}px; left: 60px;`;
    }

    // Otherwise align top of card with top of icon
    const top = Math.max(padding, rect.top - padding);
    return `top: ${top}px; left: 60px;`;
  });
</script>

{#if activeCard}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sidebar-hover-card fixed z-100"
    style={cardStyle}
    onmouseenter={() => sidebarNavStore.handleCardMouseEnter()}
    onmouseleave={() => sidebarNavStore.handleCardMouseLeave()}
    onkeydown={handleCardKeydown}
    transition:fly={{ x: -8, duration: 150 }}
  >
    <div
      class="bg-popover border border-border shadow-lg overflow-hidden flex flex-col
        {isExpanded ? 'w-80 max-h-[70vh]' : 'w-72 max-h-[50vh]'}"
    >
      <!-- Header -->
      {#if meta}
        <div class="px-3 pt-3 pb-2 shrink-0">
          <h3 class="{isExpanded ? 'text-base' : 'text-sm'} font-semibold text-foreground">
            {meta.title}
          </h3>
          <p class="{isExpanded ? 'text-xs' : 'text-ui'} text-subtle mt-0.5">
            {meta.description}
          </p>
        </div>
      {/if}

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-y-auto" bind:this={contentEl}>
        {#if activeCard === 'new-workspace'}
          <NewWorkspaceCard expanded={isExpanded} />
        {:else if activeCard === 'active'}
          <ActiveWorkspacesCard expanded={isExpanded} />
        {:else if activeCard === 'all-workspaces'}
          <AllWorkspacesCard expanded={isExpanded} />
        {/if}
      </div>
    </div>
  </div>
{/if}

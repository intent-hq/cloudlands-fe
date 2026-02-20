<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faPlus, faGear, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { scale } from 'svelte/transition';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';

  interface Props {
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    compact?: boolean;
  }

  let { onCreate, onCreateWithSpecialist, compact = false }: Props = $props();

  let isExpanded = $state(false);
  let triggerRef: HTMLButtonElement | null = $state(null);
  let contentRef: HTMLDivElement | null = $state(null);
  let portalStyle = $state('');

  // Handle creating agent with specialist
  function handleCreateAgent(specialistId: string | null) {
    if (onCreateWithSpecialist) {
      onCreateWithSpecialist(specialistId);
    } else if (onCreate) {
      onCreate();
    }
    isExpanded = false;
  }

  // Navigate to settings Agents tab
  async function openSpecialistSettings() {
    await navigateToSettings({ tab: 'agents' });
    isExpanded = false;
  }

  function handleClickOutside(event: MouseEvent) {
    if (isExpanded && triggerRef && contentRef) {
      const target = event.target as Node;
      if (!triggerRef.contains(target) && !contentRef.contains(target)) {
        isExpanded = false;
      }
    }
  }

  function handleEscape(event: KeyboardEvent) {
    if (isExpanded && event.key === 'Escape') {
      isExpanded = false;
    }
  }

  function updatePortalPosition() {
    if (!isExpanded || !triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const dropdownWidth = 250;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Position below the trigger, aligned to the left
    let top = rect.bottom + 4;
    let left = rect.left;

    // Constrain to viewport
    const margin = 8;
    left = Math.max(margin, Math.min(viewportWidth - dropdownWidth - margin, left));

    // If dropdown would go below viewport, position above trigger
    const estimatedHeight = 400;
    if (top + estimatedHeight > viewportHeight && rect.top > estimatedHeight) {
      top = rect.top - estimatedHeight - 4;
    }

    portalStyle = `left:${left}px;top:${top}px;width:${dropdownWidth}px;`;
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePortalPosition);
    window.addEventListener('scroll', updatePortalPosition, true);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('resize', updatePortalPosition);
    window.removeEventListener('scroll', updatePortalPosition, true);
  });

  $effect(() => {
    if (isExpanded) {
      requestAnimationFrame(() => updatePortalPosition());
    }
  });
</script>

{#if compact}
  <Button
    bind:ref={triggerRef}
    variant="ghost-light"
    size="icon-xs"
    class="size-6 p-0! rounded-md bg-background hover:bg-background shadow-xs"
    onclick={() => (isExpanded = !isExpanded)}
  >
    <Fa icon={faPlus} size="xs" />
  </Button>
{:else}
  <div class="w-full pb-2 -mt-1">
    <!-- Toggle Button -->
    <Button
      bind:ref={triggerRef}
      variant="ghost-light"
      size="xs"
      class="w-full px-0! justify-start gap-1.5 font-normal text-sm"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faPlus} size="xs" class="opacity-60 mr-1.25 ml-2.75" />
      Create new agent
    </Button>
  </div>
{/if}

<!-- Portal dropdown -->
{#if isExpanded}
  <Portal zIndex={10000}>
    <div
      bind:this={contentRef}
      class="fixed z-[10000] bg-popover border border-border shadow-lg overflow-hidden"
      style={portalStyle}
      transition:scale={{ duration: 150, start: 0.95 }}
    >
      <!-- Blank Agent Option -->
      <button
        class="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left border-b border-border cursor-pointer"
        onclick={() => handleCreateAgent(null)}
      >
        <AuggieAvatar faceSeed="blank" colorSeed="blank" size={22} class="-mt-1" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">Blank Agent</div>
          <div class="text-sm text-muted-foreground">Start fresh, no custom prompt</div>
        </div>
      </button>

      <!-- Specialist Explanation -->
      <div class="px-3 pt-2">
        <p class="text-sm text-muted-foreground">
          <span class="text-foreground font-medium">Specialists</span> are pre-configured agent types.
        </p>
      </div>

      <!-- Specialist Cards -->
      <div class="pt-1.5 max-h-[280px] overflow-y-auto">
        {#each specialistsStore.specialists as specialist (specialist.id)}
          <button
            class="w-full px-2.5 py-2 flex items-start gap-2.5 hover:bg-muted/50 transition-colors text-left group cursor-pointer"
            onclick={() => handleCreateAgent(specialist.id)}
          >
            <AuggieAvatar
              faceSeed="blank"
              colorSeed="blank"
              size={20}
              specialist={specialist.id}
              class="mt-0.5 shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{specialist.name}</div>
              <div class="text-sm text-muted-foreground line-clamp-2">{specialist.description}</div>
            </div>
          </button>
        {/each}
      </div>

      <!-- Settings Link -->
      <div class="border-t border-border">
        <Button
          variant="ghost-light"
          size="sm"
          class="w-full justify-start px-3! py-2!"
          onclick={openSpecialistSettings}
        >
          <Fa icon={faGear} size="xs" />
          <span>Customize specialists</span>
        </Button>
      </div>
    </div>
  </Portal>
{/if}

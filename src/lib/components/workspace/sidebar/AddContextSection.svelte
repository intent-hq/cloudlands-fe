<script lang="ts">
  /**
   * AddContextSection - Expandable panel for adding context items
   *
   * Provides a sleek UI for adding various context types:
   * - Notes
   * - Integrations (Linear, GitHub, Sentry - shows inline picker)
   * - Browser (opens browser panel)
   */
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faPlus, faChevronDown, faPuzzlePiece, faGlobe } from '@fortawesome/free-solid-svg-icons';
  import { scale } from 'svelte/transition';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import IssueSuggestions, {
    type IssueSelectionData,
  } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';

  interface Props {
    onAddNote?: () => void;
    onSelectIntegration?: (text: string, metadata?: IssueSelectionData) => void;
    onOpenBrowser?: () => void;
    compact?: boolean;
  }

  let { onAddNote, onSelectIntegration, onOpenBrowser, compact = false }: Props = $props();

  let isExpanded = $state(false);
  let showIntegrations = $state(false);
  let triggerRef: HTMLButtonElement | null = $state(null);
  let contentRef: HTMLDivElement | null = $state(null);
  let integrationsRef: HTMLDivElement | null = $state(null);
  let integrationsAnchor: HTMLButtonElement | null = $state<HTMLButtonElement | null>(null);
  let portalStyle = $state('');

  function handleNoteClick() {
    onAddNote?.();
    isExpanded = false;
  }

  function handleIntegrationsClick() {
    showIntegrations = !showIntegrations;
  }

  function handleBrowserClick() {
    onOpenBrowser?.();
    isExpanded = false;
  }

  function handleIntegrationSelect(text: string, metadata?: IssueSelectionData) {
    onSelectIntegration?.(text, metadata);
    showIntegrations = false;
    isExpanded = false;
  }

  function handleClickOutside(event: MouseEvent) {
    if (!isExpanded) return;
    const target = event.target as Node;

    // Check if click is inside trigger
    if (triggerRef?.contains(target)) return;

    // Check if click is inside the main dropdown content
    if (contentRef?.contains(target)) return;

    // Check if click is inside the integrations picker
    if (integrationsRef?.contains(target)) return;

    // Close both dropdowns
    isExpanded = false;
    showIntegrations = false;
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (showIntegrations) {
        event.stopPropagation();
        showIntegrations = false;
      } else if (isExpanded) {
        isExpanded = false;
      }
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
    const estimatedHeight = 200;
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
    } else {
      // Close integrations when main dropdown closes
      showIntegrations = false;
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
  <div class="w-full px-1 -mt-1">
    <!-- Toggle Button -->
    <Button
      bind:ref={triggerRef}
      variant="ghost-light"
      size="sm"
      class="w-full justify-start px-0! gap-1.5 font-normal text-sm"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faPlus} size="xs" class="opacity-60 ml-1.75 mr-1.25" />
      Add context
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
      <div class="">
        <!-- Note -->
        <button
          class="w-full px-3 py-2 flex items-center gap-2.5 transition-colors text-left hover:bg-muted/50 cursor-pointer"
          onclick={handleNoteClick}
        >
          <div class="w-5 h-5 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            <ProviderIcon provider="internal" size={12} class="opacity-70" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">Note</div>
            <div class="text-xs text-muted-foreground">Add a new note</div>
          </div>
        </button>

        <!-- Integrations -->
        <!-- TODO: these aren't hooked up rn -->
        <!-- <button
          bind:this={integrationsAnchor}
          class="w-full px-3 py-2 flex items-center gap-2.5 transition-colors text-left hover:bg-muted/50 cursor-pointer
                 {showIntegrations ? 'bg-muted/50' : ''}"
          onclick={handleIntegrationsClick}
        >
          <div class="w-5 h-5 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            <Fa icon={faPuzzlePiece} size="xs" class="opacity-70" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">Integrations</div>
            <div class="text-xs text-muted-foreground">Linear, GitHub, Sentry</div>
          </div>
        </button> -->

        <!-- Browser -->
        <button
          class="w-full px-3 py-2 flex items-center gap-2.5 transition-colors text-left hover:bg-muted/50 cursor-pointer"
          onclick={handleBrowserClick}
        >
          <div class="w-5 h-5 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            <Fa icon={faGlobe} size="xs" class="opacity-70" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">Browser</div>
            <div class="text-xs text-muted-foreground">Open browser panel</div>
          </div>
        </button>
      </div>
    </div>
  </Portal>
{/if}

<!-- Integrations picker shown as portal to the right of the integrations button -->
{#if showIntegrations && integrationsAnchor}
  {@const rect = integrationsAnchor.getBoundingClientRect()}
  {@const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1000}
  {@const pickerWidth = 480}
  {@const spaceOnRight = viewportWidth - rect.right - 16}
  {@const positionRight = spaceOnRight >= pickerWidth}
  <Portal zIndex={10001}>
    <div
      bind:this={integrationsRef}
      class="fixed z-[10001] bg-popover border border-border shadow-lg overflow-hidden"
      style="top: {rect.top}px; {positionRight
        ? `left: ${rect.right + 8}px`
        : `right: ${viewportWidth - rect.left + 8}px`}; width: {Math.min(
        pickerWidth,
        viewportWidth - 32,
      )}px;"
      transition:scale={{ duration: 150, start: 0.95 }}
    >
      <IssueSuggestions
        onSelect={handleIntegrationSelect}
        initiallyExpanded={true}
        hideToggle={true}
      />
    </div>
  </Portal>
{/if}

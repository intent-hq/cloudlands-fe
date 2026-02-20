<script lang="ts">
  /**
   * SelectionPickerButton
   *
   * A button that appears when there's selected text across panels.
   * Opens a popover showing all selections with checkboxes to toggle them.
   */

  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faQuoteLeft,
    faFileLines,
    faNoteSticky,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import Button from '$lib/components/ui/button/button.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import type { SelectionContextItem } from '$lib/stores/multi-panel-context.store.svelte';

  interface Props {
    selections: SelectionContextItem[];
    disabled?: boolean;
    onToggle?: (id: string) => void;
    onRemove?: (id: string) => void;
    class?: string;
  }

  let {
    selections = [],
    disabled = false,
    onToggle,
    onRemove,
    class: className = '',
  }: Props = $props();

  let isOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let popoverStyle = $state('');

  // Count of checked selections for badge
  let checkedCount = $derived(selections.filter((s) => s.checked).length);

  // Only show button if there are selections
  let hasSelections = $derived(selections.length > 0);

  function getSourceIcon(type: SelectionContextItem['sourceType']) {
    return type === 'file' ? faFileLines : faNoteSticky;
  }

  function truncateText(text: string, maxLength: number = 60): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  function toggleOpen() {
    if (disabled || !hasSelections) return;
    isOpen = !isOpen;
    if (isOpen) {
      updatePosition();
    }
  }

  function updatePosition() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.top;
    const estimatedHeight = Math.min(selections.length * 72 + 60, 350);

    // Position above the button
    if (spaceBelow < estimatedHeight) {
      popoverStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; left: ${rect.left}px; min-width: 280px; max-width: 360px;`;
    } else {
      popoverStyle = `position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px; min-width: 280px; max-width: 360px;`;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (!isOpen) return;
    const target = e.target as Node;
    if (triggerRef?.contains(target) || popoverRef?.contains(target)) return;
    isOpen = false;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      isOpen = false;
    }
  }

  function handleToggleItem(id: string) {
    onToggle?.(id);
  }

  function handleRemoveItem(id: string, e: MouseEvent) {
    e.stopPropagation();
    onRemove?.(id);
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if hasSelections}
  <TooltipShortcut label="Selected text ({selections.length})" side="top">
    <Button
      bind:ref={triggerRef}
      variant="ghost-light"
      size="icon-xs"
      onclick={toggleOpen}
      {disabled}
      aria-label="Selected text context"
      aria-haspopup="true"
      aria-expanded={isOpen}
      class={cn('shrink-0 relative', className)}
    >
      <Fa icon={faQuoteLeft} size="sm" />
      {#if checkedCount > 0}
        <span
          class="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-1 text-[10px] font-medium
                 rounded-full bg-accent text-accent-foreground flex items-center justify-center"
        >
          {checkedCount}
        </span>
      {/if}
    </Button>
  </TooltipShortcut>

  {#if isOpen}
    <Portal zIndex={60}>
      <div
        bind:this={popoverRef}
        class={cn(
          'overflow-hidden rounded-lg border border-border',
          'bg-popover text-popover-foreground shadow-lg',
        )}
        style={popoverStyle}
        role="dialog"
        aria-label="Selected text"
      >
        <!-- Header -->
        <div class="px-3 py-2 border-b border-border bg-muted/30">
          <div class="text-xs font-medium text-muted-foreground">
            Selected text ({selections.length})
          </div>
        </div>

        <!-- Selection list -->
        <div class="max-h-[280px] overflow-y-auto py-1">
          {#each selections as selection (selection.id)}
            <div
              class="group flex items-start gap-2.5 px-3 py-2
                     hover:bg-muted/40 cursor-pointer transition-colors"
              role="button"
              tabindex="0"
              onclick={() => handleToggleItem(selection.id)}
              onkeydown={(e) => e.key === 'Enter' && handleToggleItem(selection.id)}
            >
              <Checkbox
                checked={selection.checked}
                size="sm"
                class="mt-0.5"
                onCheckedChange={() => handleToggleItem(selection.id)}
              />
              <div class="flex-1 min-w-0">
                <!-- Source label -->
                <div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                  <Fa icon={getSourceIcon(selection.sourceType)} class="h-3 w-3" />
                  <span class="truncate">{selection.sourceLabel}</span>
                </div>
                <!-- Preview text -->
                <div class="text-sm text-foreground/90 line-clamp-2 break-words">
                  {truncateText(selection.text, 80)}
                </div>
              </div>
              <!-- Remove button -->
              <button
                type="button"
                onclick={(e) => handleRemoveItem(selection.id, e)}
                class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted/60
                       text-muted-foreground hover:text-foreground transition-all"
                aria-label="Remove selection"
              >
                <Fa icon={faXmark} class="h-3 w-3" />
              </button>
            </div>
          {/each}
        </div>
      </div>
    </Portal>
  {/if}
{/if}

<script lang="ts">
  /**
   * Content Header Component
   *
   * A unified header for all content panels in the workspace.
   * Features:
   * - Navigation buttons (back/forward) - always visible
   * - Breadcrumb support (category > title)
   * - Icon display
   * - Editable title
   * - Action buttons area
   * - Close button
   */

  import Fa from 'svelte-fa';
  import { faXmark, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { BreadcrumbItem } from './types';

  interface Props {
    /** Main title - displayed after breadcrumbs */
    title: string;
    /** Optional subtitle below the title */
    subtitle?: string;
    /** Breadcrumb items (e.g., [{label: 'Notes', icon: faStickyNote}]) */
    breadcrumbs?: BreadcrumbItem[];
    /** Icon to show before title (if no breadcrumbs) */
    icon?: IconDefinition;
    /** Navigation state */
    canGoBack?: boolean;
    canGoForward?: boolean;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
    /** Close button */
    showClose?: boolean;
    onClose?: () => void;
    /** Editable title */
    editableTitle?: boolean;
    onTitleChange?: (newTitle: string) => void;
    /** Custom actions slot */
    actions?: Snippet;
    /** Additional classes */
    class?: string;
  }

  let {
    title,
    subtitle,
    breadcrumbs = [],
    icon,
    canGoBack = false,
    canGoForward = false,
    onNavigateBack,
    onNavigateForward,
    showClose = true,
    onClose,
    editableTitle = false,
    onTitleChange,
    actions,
    class: className = '',
  }: Props = $props();

  // State for inline editing
  let isEditingTitle = $state(false);
  let editedTitle = $state(title);
  let titleInputRef: HTMLInputElement | null = $state(null);

  // Update edited title when prop changes
  $effect(() => {
    editedTitle = title;
  });

  async function startEditingTitle() {
    if (!editableTitle) return;
    isEditingTitle = true;
    editedTitle = title;
    await tick();
    if (titleInputRef) {
      titleInputRef.focus();
      titleInputRef.select();
    }
  }

  function saveTitle() {
    if (editedTitle.trim() && editedTitle !== title) {
      onTitleChange?.(editedTitle.trim());
    }
    isEditingTitle = false;
  }

  function cancelEditingTitle() {
    editedTitle = title;
    isEditingTitle = false;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTitle();
    }
  }
</script>

<div class="h-(--panel-header-height) flex items-center justify-between px-3 shrink-0 {className}">
  <!-- Left side: Navigation + Breadcrumbs + Title -->
  <div class="flex items-center min-w-0 h-full gap-0">
    <!-- Breadcrumbs + Icon + Title -->
    <div class="flex items-center min-w-0 px-2 gap-2">
      {#each breadcrumbs as crumb, i (`crumb-${i}-${crumb.label}`)}
        {#if crumb.onClick}
          <button
            onclick={crumb.onClick}
            class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {#if crumb.icon}
              <Fa icon={crumb.icon} class="w-3 h-3 opacity-50" />
            {/if}
            <span class="truncate max-w-24">{crumb.label}</span>
          </button>
        {:else}
          <span
            class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase text-muted-foreground"
          >
            {#if crumb.icon}
              <Fa icon={crumb.icon} class="w-3 h-3 opacity-50" />
            {/if}
            <span class="truncate max-w-24">{crumb.label}</span>
          </span>
        {/if}
        <div class="mx-0.5 font-medium text-xs text-muted-foreground opacity-30">/</div>
      {/each}

      {#if icon && breadcrumbs.length === 0}
        <Fa {icon} class="w-3.5 h-3.5 text-muted-foreground opacity-50 shrink-0" />
      {/if}

      <!-- Title -->
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- <Fa icon={faChevronLeft} class="w-2.5! h-2.5! text-muted-foreground opacity-50 shrink-0" /> -->
        {#if isEditingTitle}
          <input
            bind:this={titleInputRef}
            type="text"
            bind:value={editedTitle}
            onblur={saveTitle}
            onkeydown={handleTitleKeydown}
            class="text-sm font-medium bg-transparent border-none outline-none focus:ring-0 px-0"
            style="width: {editedTitle.length + 2}ch; min-width: 100px;"
          />
        {:else}
          <button
            class="text-sm font-medium truncate text-left hover:opacity-80 transition-opacity {editableTitle
              ? 'cursor-text'
              : 'cursor-default'}"
            onclick={startEditingTitle}
            disabled={!editableTitle}
            title={editableTitle ? 'Click to edit' : title}
          >
            {title}
          </button>
        {/if}
        {#if subtitle}
          <span class="text-xs text-muted-foreground truncate">{subtitle}</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Right side: Actions + Close -->
  <div class="flex items-center ml-2 shrink-0">
    {#if actions}
      {@render actions()}
    {/if}

    <!-- Navigation buttons - always present -->
    <div class="flex items-center h-full mr-1 relative border-l border-border ml-3">
      <div class="flex items-center h-full pl-3">
        <TooltipShortcut label="Go back" shortcut="cmd+[" side="bottom" delayDuration={300}>
          <Button
            size="icon-xs"
            variant="ghost-light"
            onclick={() => onNavigateBack?.()}
            disabled={!canGoBack}
            class="rounded-none h-full py-2 pr-0!"
          >
            <Fa icon={faChevronLeft} size="sm" />
          </Button>
        </TooltipShortcut>
        <TooltipShortcut label="Go forward" shortcut="cmd+]" side="bottom" delayDuration={300}>
          <Button
            size="icon-xs"
            variant="ghost-light"
            onclick={() => onNavigateForward?.()}
            disabled={!canGoForward}
            class="rounded-none h-full py-2 pl-0!"
          >
            <Fa icon={faChevronRight} size="sm" />
          </Button>
        </TooltipShortcut>
      </div>
    </div>

    {#if showClose && onClose}
      <TooltipShortcut label="Close panel" side="bottom" delayDuration={300}>
        <Button size="icon-xs" variant="ghost-light" onclick={onClose}>
          <Fa icon={faXmark} size="sm" />
        </Button>
      </TooltipShortcut>
    {/if}
  </div>
</div>

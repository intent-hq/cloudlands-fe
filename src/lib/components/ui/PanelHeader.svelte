<script lang="ts">
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import type { ComponentType, Snippet } from 'svelte';
  import { tick } from 'svelte';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

  interface Props {
    title: string;
    subtitle?: string;
    icon?: ComponentType;
    faIcon?: IconDefinition;
    onClose?: () => void;
    showClose?: boolean;
    class?: string;
    children?: Snippet;
    navigationButtons?: Snippet;
    editableTitle?: boolean;
    onTitleChange?: (newTitle: string) => void;
  }

  let {
    title,
    subtitle,
    icon: Icon,
    faIcon,
    onClose,
    showClose = true,
    class: className = '',
    children,
    navigationButtons,
    editableTitle = false,
    onTitleChange,
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

<div
  class="h-[var(--panel-header-height)] flex items-center justify-between bg-sidebar px-3 {className}"
>
  <!-- Left side: Navigation, Icon, and Title -->
  <div class="flex items-center min-w-0 h-full">
    <!-- Navigation buttons on the far left -->
    {#if navigationButtons}
      {@render navigationButtons()}
    {/if}

    <!-- Icon and Title section -->
    <div class="flex items-center gap-2 min-w-0 px-2">
      {#if Icon}
        <Icon class="w-4 h-4 text-ghost opacity-50 shrink-0" />
      {:else if faIcon}
        <Fa icon={faIcon} class="w-4 h-4 text-ghost opacity-50 shrink-0" />
      {/if}
      <div class="flex items-center gap-1.5 min-w-0">
        {#if isEditingTitle}
          <input
            bind:this={titleInputRef}
            type="text"
            bind:value={editedTitle}
            onblur={saveTitle}
            onkeydown={handleTitleKeydown}
            class="text-sm font-medium bg-transparent border-none outline-none focus:outline-none focus:ring-0! px-0"
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
          <span class="text-xs text-subtle truncate">{subtitle}</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Right side: Actions and Close -->
  <div class="flex items-center gap-1 ml-2">
    <!-- Custom actions snippet -->
    {#if children}
      {@render children()}
    {/if}

    <!-- Close button -->
    {#if showClose && onClose}
      <TooltipShortcut label="Close panel" side="bottom" delayDuration={300}>
        <Button size="icon-xs" variant="ghost-light" onclick={onClose}>
          <Fa icon={faXmark} size="xs" />
        </Button>
      </TooltipShortcut>
    {/if}
  </div>
</div>

<script lang="ts">
  /**
   * KeyboardShortcutsCheatSheet - Context-aware keyboard shortcuts overlay
   *
   * Shows relevant shortcuts based on the current context (chat, editor, panel, etc.)
   * Triggered by Mod+/ or ? key
   */

  import {
  fade,
  fly,
} from 'svelte/transition';
  import { faTimes } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
  getAllShortcutCategories,
  formatShortcut,
  type ShortcutCategory,
} from '$lib/utils/shortcuts';
  import Button from '../ui/button/button.svelte';
  import Header from '../ui/Header.svelte';
  import {
  selectIsCheatSheetOpen,
  selectCheatSheetContext,
} from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-selectors';
  import { closeCheatSheet } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { store as appStore } from '$store/renderer/store';


  const isOpen = selectIsCheatSheetOpen();
  const context = selectCheatSheetContext();

  const categories = getAllShortcutCategories();
  const categoryOrder: ShortcutCategory[] = [
    'global',
    'navigation',
    'chat',
    'editor',
    'panel',
    'leader',
  ];

  function handleClose() {
    appStore.dispatch(closeCheatSheet());
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if $isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={handleBackdropClick}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="cheat-sheet bg-popover shadow-2xl max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
      transition:fly={{ y: 20, duration: 200 }}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-9 pr-7 pt-6">
        <div class="flex items-center gap-3">
          <!-- <Fa icon={faKeyboard} class="text-primary" /> -->
          <span class="text-lg font-semibold">Keyboard Shortcuts</span>
          {#if $context !== 'global'}
            <span class="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full capitalize">
              {$context} context
            </span>
          {/if}
        </div>
        <Button variant="ghost-light" size="icon-xs" onclick={handleClose}>
          <Fa icon={faTimes} size={12} />
        </Button>
      </div>

      <!-- Shortcuts Grid -->
      <div class="flex-1 overflow-y-auto px-9 pt-8 pb-11">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-9">
          {#each categoryOrder as category}
            {@const data = categories[category]}
            <div class="category-card">
              <Header size={3}>
                {data.title}
              </Header>
              <ul class="mt-1.25 space-y-1.25">
                {#each data.shortcuts as shortcut}
                  <li class="flex items-center justify-between gap-4 text-sm">
                    <span class="text-subtle truncate">{shortcut.label}</span>
                    <span class="text-subtle text-xs whitespace-nowrap">
                      {formatShortcut(shortcut.key)}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .cheat-sheet {
    width: min(90vw, 900px);
  }
</style>

<script lang="ts">
  /**
   * KeyboardShortcutsCheatSheet - Context-aware keyboard shortcuts overlay
   *
   * Shows relevant shortcuts based on the current context (chat, editor, panel, etc.)
   * Triggered by Mod+/ or ? key
   */

  import { m } from '$shared/paraglide/messages.js';
  import {
    getAllShortcutCategories,
    formatShortcut,
    type ShortcutCategory,
  } from '$lib/utils/shortcuts';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import Header from '../ui/Header.svelte';
  import {
    selectIsCheatSheetOpen,
    selectCheatSheetContext,
  } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-selectors';
  import { closeCheatSheet } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { store as appStore } from '$store/renderer/store';
  import { selectShortcutOverrides } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  const isOpen = selectIsCheatSheetOpen();
  const context = selectCheatSheetContext();

  const shortcutOverrides = selectShortcutOverrides();
  const categories = $derived(getAllShortcutCategories($shortcutOverrides));
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
</script>

{#if $isOpen}
  <ContentDialog
    open
    title={m.layout_cheatSheet_title()}
    description={$context !== 'global'
      ? m.layout_cheatSheet_context_label({ context: $context })
      : undefined}
    size="wide"
    closeLabel={m.layout_cheatSheet_close_ariaLabel()}
    onClose={handleClose}
  >
    <div class="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-6">
      {#each categoryOrder as category}
        {@const data = categories[category]}
        <div class="category-card">
          <Header size={3}>
            {data.title}
          </Header>
          <ul class="mt-1.25 space-y-1.25">
            {#each data.shortcuts as shortcut}
              <li class="flex items-center justify-between gap-4 text-sm">
                <span class="text-subtle break-words">{shortcut.label}</span>
                <span class="text-subtle text-xs whitespace-nowrap">
                  {formatShortcut(shortcut.key)}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </ContentDialog>
{/if}

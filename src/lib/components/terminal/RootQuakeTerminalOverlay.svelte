<script lang="ts" module>
  // Special workspace ID for root-level terminals (outside workspace context)
  // Exported from module context so it can be imported by other files
  export const ROOT_WORKSPACE_ID = '__root__';
</script>

<script lang="ts">
  /**
   * RootQuakeTerminalOverlay - Quake-style terminal overlay for non-workspace pages
   *
   * This component provides a terminal overlay that works outside of workspace context.
   * It's invisible by default (no tab bar) and only shows when triggered via keyboard shortcuts.
   * Terminals run in the user's home directory.
   *
   * Features:
   * - Invisible by default (no terminals shown until user triggers)
   * - Smooth slide-up animation for terminal panel
   * - Multiple terminal tabs with close buttons
   * - Drag-to-resize handle
   * - Keyboard shortcuts (Cmd+J / Ctrl+J to toggle)
   */
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    selectIsTerminalOverlayOpen,
    selectTerminalOverlayHeight,
    selectTerminalOverlayWorkspaceId,
    selectActiveTerminalId,
    selectTerminals,
  } from '$lib/store/slices/terminal-overlay/terminal-overlay-selectors';
  import {
    openTerminalOverlay,
    closeTerminalOverlay,
    toggleTerminalOverlay,
    selectTerminal as selectTerminalAction,
    addTerminal,
    removeTerminal,
    setTerminalOverlayHeight,
    renameTerminal,
  } from '$lib/store/slices/terminal-overlay/terminal-overlay-slice';
  // RootQuakeTerminalOverlay uses ROOT_WORKSPACE_ID as its workspace ID
  import { getDispatch } from '$lib/store/utils/utils';
  import Terminal from './Terminal.svelte';
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faXmark,
    faChevronDown,
    faTerminal,
    faBan,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Button from '$lib/components/ui/button/button.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';

  // Store bindings
  const dispatch = getDispatch();
  const isOpen = selectIsTerminalOverlayOpen();
  const height = selectTerminalOverlayHeight();
  const storeWorkspaceId = selectTerminalOverlayWorkspaceId();
  const activeTerminalId = selectActiveTerminalId();
  const terminals = selectTerminals();

  // Only show when store is bound to root workspace
  const isRootContext = $derived($storeWorkspaceId === ROOT_WORKSPACE_ID);

  // NOTE: We intentionally do NOT have an $effect here to sync workspace ID.
  // The workspace ID is set by the keyboard shortcut handler in +layout.svelte
  // when the user explicitly toggles the terminal. This prevents conflicts
  // with QuakeTerminalOverlay during page navigation transitions.

  // UI state
  let isResizing = $state(false);
  let editingTerminalId = $state<string | null>(null);
  let editingValue = $state('');
  let isEditingHeaderName = $state(false);
  let headerEditValue = $state('');

  // Constants
  const TAB_BAR_HEIGHT = 36;

  // ============================================================================
  // Tab Display Logic
  // ============================================================================

  function getTabDisplayName(term: { id: string; name: string; customName?: string }): string {
    if (term.customName) return term.customName;
    const lastCommand = terminalHistoryTracker.getLastCommand(term.id);
    if (lastCommand) {
      return lastCommand.length > 20 ? lastCommand.slice(0, 20) + '…' : lastCommand;
    }
    return term.name || 'Terminal';
  }

  // ============================================================================
  // Tab Editing
  // ============================================================================

  function startEditing(termId: string, currentName: string) {
    editingTerminalId = termId;
    editingValue = currentName;
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-edit-terminal="${termId}"]`) as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditing() {
    if (editingTerminalId) {
      dispatch(renameTerminal(ROOT_WORKSPACE_ID, editingTerminalId, editingValue));
      editingTerminalId = null;
      editingValue = '';
    }
  }

  function cancelEditing() {
    editingTerminalId = null;
    editingValue = '';
  }

  function handleEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }

  // Header name editing
  function startEditingHeaderName() {
    if (!$activeTerminalId) return;
    const term = $terminals.find((t) => t.id === $activeTerminalId);
    if (!term) return;
    isEditingHeaderName = true;
    headerEditValue = term.customName || term.name || 'Terminal';
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-edit-header-terminal]') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingHeaderName() {
    if (isEditingHeaderName && $activeTerminalId) {
      dispatch(renameTerminal(ROOT_WORKSPACE_ID, $activeTerminalId, headerEditValue));
    }
    isEditingHeaderName = false;
    headerEditValue = '';
  }

  function cancelEditingHeaderName() {
    isEditingHeaderName = false;
    headerEditValue = '';
  }

  function handleHeaderEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingHeaderName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingHeaderName();
    }
  }

  // ============================================================================
  // Terminal Actions
  // ============================================================================

  function handleClose() {
    dispatch(closeTerminalOverlay(ROOT_WORKSPACE_ID));
  }

  let overlayContainer = $state<HTMLDivElement>();

  function createNewTerminal() {
    const newId = `terminal-root-${Date.now()}`;
    dispatch(addTerminal(ROOT_WORKSPACE_ID, newId, `Terminal ${$terminals.length + 1}`));
    if (!$isOpen) {
      dispatch(openTerminalOverlay(ROOT_WORKSPACE_ID, newId));
    }
    // Focus the overlay container immediately so keyboard shortcuts
    // route to the terminal before xterm is ready
    requestAnimationFrame(() => {
      overlayContainer?.focus();
    });
  }

  function closeTerminal(termId: string, e?: MouseEvent) {
    e?.stopPropagation();
    dispatch(removeTerminal(ROOT_WORKSPACE_ID, termId));
    terminalManager.disposeTerminal(termId);
  }

  function clearActiveTerminal() {
    if ($activeTerminalId) {
      terminalManager.clearTerminal($activeTerminalId);
    }
  }

  // Track pending single click to differentiate from double-click
  let pendingClickTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleTabClick(termId: string) {
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }

    pendingClickTimeout = setTimeout(() => {
      pendingClickTimeout = null;
      if (termId === $activeTerminalId && $isOpen) {
        handleClose();
      } else {
        dispatch(selectTerminalAction(ROOT_WORKSPACE_ID, termId));
        if (!$isOpen) {
          dispatch(openTerminalOverlay(ROOT_WORKSPACE_ID, termId));
        }
      }
    }, 200);
  }

  function handleTabDoubleClick(termId: string, customName: string | undefined, e: MouseEvent) {
    e.stopPropagation();
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }
    startEditing(termId, customName || '');
  }

  function cycleTerminal(direction: 1 | -1) {
    if (!$activeTerminalId || $terminals.length <= 1) return;
    const currentIndex = $terminals.findIndex((t) => t.id === $activeTerminalId);
    const nextIndex = (currentIndex + direction + $terminals.length) % $terminals.length;
    dispatch(selectTerminalAction(ROOT_WORKSPACE_ID, $terminals[nextIndex].id));
  }

  // ============================================================================
  // Resize Handling
  // ============================================================================

  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing) return;
    const windowHeight = window.innerHeight;
    const newHeight = ((windowHeight - event.clientY) / windowHeight) * 100;
    dispatch(setTerminalOverlayHeight(newHeight));
  }

  function stopResize() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  // Listen for custom events from terminal adapter (when terminal has focus)
  $effect(() => {
    if (typeof window === 'undefined') return;

    function handleToggle() {
      // Only handle if we're in root context
      if (isRootContext) {
        dispatch(toggleTerminalOverlay(ROOT_WORKSPACE_ID));
      }
    }

    function handleCreateNew() {
      if (isRootContext) {
        createNewTerminal();
      }
    }

    function handleCloseActive() {
      if (isRootContext && activeTerminalId) {
        closeTerminal(activeTerminalId);
      }
    }

    window.addEventListener('terminal:toggle-overlay', handleToggle);
    window.addEventListener('terminal:create-new', handleCreateNew);
    window.addEventListener('terminal:close-active', handleCloseActive);

    return () => {
      window.removeEventListener('terminal:toggle-overlay', handleToggle);
      window.removeEventListener('terminal:create-new', handleCreateNew);
      window.removeEventListener('terminal:close-active', handleCloseActive);
    };
  });

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  function handleKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;

    // Only handle when in root context and terminal is open
    if (!isRootContext || !$isOpen) return;

    // Tab cycling shortcuts should only work when focus is in the terminal
    const isTerminalFocused = isFocusInTerminal(event.target as HTMLElement | null);
    if (!isTerminalFocused) return;

    if ($terminals.length <= 1) return;

    // Cmd+Shift+] - Next terminal
    if ((event.key === ']' || event.key === '}') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cycleTerminal(1);
      return;
    }

    // Cmd+Shift+[ - Previous terminal
    if ((event.key === '[' || event.key === '{') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cycleTerminal(-1);
      return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Only render when the overlay is open in root context (invisible when closed) -->
{#if isRootContext && $isOpen && $activeTerminalId}
  <!-- tabindex=-1 allows programmatic focus for keyboard shortcut routing -->
  <div
    bind:this={overlayContainer}
    tabindex="-1"
    class="terminal-overlay flex flex-col w-full outline-none"
  >
    <!-- Expanded Terminal Panel -->
    <div
      class="terminal-panel relative flex flex-col bg-sidebar border-t border-border/50 shadow-2xl w-full"
      class:is-resizing={isResizing}
      style="height: {$height}vh;"
      transition:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
    >
      <!-- Resize Handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute -top-1 left-0 right-0 h-3 cursor-ns-resize z-10 flex items-center justify-center group/resize"
        onmousedown={startResize}
      >
        <div
          class="w-9 h-1 rounded-sm bg-muted-foreground/20 transition-all duration-150 group-hover/resize:bg-muted-foreground/40 group-hover/resize:scale-x-110"
        ></div>
      </div>

      <!-- Header Bar -->
      <div
        class="flex items-center justify-between h-9 px-3 bg-sidebar/50 border-b border-border/30 shrink-0"
      >
        <!-- Title (click to edit) -->
        <div class="flex items-center gap-2">
          <Fa icon={faTerminal} class="w-3.5 h-3.5 opacity-60" />
          {#if isEditingHeaderName}
            <input
              type="text"
              data-edit-header-terminal
              bind:value={headerEditValue}
              onblur={finishEditingHeaderName}
              onkeydown={handleHeaderEditKeydown}
              class="text-sm font-medium bg-transparent border-0 outline-none focus:outline-none! focus:ring-0! px-0 w-40 text-muted-foreground"
              placeholder="Terminal name"
            />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onclick={startEditingHeaderName}
              ondblclick={startEditingHeaderName}
              title="Click to rename terminal"
            >
              {$terminals.find((t) => t.id === $activeTerminalId)?.customName ||
                $terminals.find((t) => t.id === $activeTerminalId)?.name ||
                'Terminal'}
            </span>
          {/if}
        </div>

        <!-- Clear and Collapse Buttons -->
        <div class="flex items-center gap-0.5">
          <!-- Clear Button -->
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={clearActiveTerminal}
            tooltip="Clear Terminal"
            tooltipShortcut="⌘K"
            aria-label="Clear terminal"
          >
            <Fa icon={faBan} size="xs" />
          </Button>

          <!-- Collapse Button -->
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={handleClose}
            tooltip="Collapse Terminal"
            tooltipShortcut="mod+J"
            aria-label="Collapse terminal"
          >
            <Fa icon={faChevronDown} size="xs" />
          </Button>
        </div>
      </div>

      <!-- Terminal Content -->
      <div class="flex-1 overflow-hidden">
        {#key $activeTerminalId}
          <Terminal
            terminalId={$activeTerminalId}
            workspaceId={ROOT_WORKSPACE_ID}
            class="h-full w-full"
          />
        {/key}
      </div>

      <!-- Tab Bar - integrated into the terminal panel for root overlay -->
      <div
        class="flex items-center justify-between h-9 px-1 bg-sidebar backdrop-blur-xl border-t border-border/50 shrink-0"
      >
        <div class="flex items-center h-full min-w-0 overflow-x-auto scrollbar-none">
          <div class="pl-2 pr-3">
            <Fa icon={faTerminal} class="shrink-0 w-3.5 h-3.5 opacity-60" />
          </div>

          {#each $terminals as term (term.id)}
            {@const isActive = term.id === $activeTerminalId}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class={cn(
                'flex items-center gap-1.5 h-full px-2.5 text-sm font-medium text-subtle cursor-pointer transition-all duration-150 min-w-0 max-w-90 whitespace-nowrap border-x border-border/50 -ml-px group/tab',
                'hover:text-foreground hover:bg-muted/80',
                isActive && 'text-foreground bg-background shadow-sm',
              )}
              onclick={() => handleTabClick(term.id)}
              ondblclick={(e) => handleTabDoubleClick(term.id, term.customName, e)}
              onkeydown={(e) => e.key === 'Enter' && handleTabClick(term.id)}
              role="tab"
              tabindex="0"
              aria-selected={isActive}
            >
              {#if editingTerminalId === term.id}
                <input
                  type="text"
                  data-edit-terminal={term.id}
                  bind:value={editingValue}
                  onblur={finishEditing}
                  onkeydown={handleEditKeydown}
                  onclick={(e) => e.stopPropagation()}
                  placeholder="Name"
                  class="w-60 p-0 border-none bg-transparent font-inherit text-inherit outline-none focus:outline-none! focus:ring-0!"
                />
              {:else}
                <span class="overflow-hidden text-ellipsis whitespace-nowrap"
                  >{getTabDisplayName(term)}</span
                >
              {/if}

              <button
                type="button"
                class="ml-0.5 p-1 text-muted-foreground hover:text-muted-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity duration-150 cursor-pointer"
                onclick={(e) => closeTerminal(term.id, e)}
                aria-label="Close terminal"
              >
                <Fa icon={faXmark} size="xs" />
              </button>
            </div>
          {/each}

          <Tooltip content="New Terminal (⌘⇧N)" side="top" delayDuration={300}>
            <button
              type="button"
              class="flex items-center justify-center w-7 h-7 ml-1 border-none rounded-md bg-transparent text-muted-foreground cursor-pointer transition-all duration-150 hover:bg-muted/80 hover:text-foreground"
              onclick={createNewTerminal}
              aria-label="New terminal"
            >
              <Fa icon={faPlus} class="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        <div class="flex items-center gap-0.5 pl-2">
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={handleClose}
            tooltip="Collapse Terminal"
            tooltipShortcut="mod+J"
            aria-label="Collapse terminal"
          >
            <Fa icon={faChevronDown} size="xs" />
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .terminal-panel.is-resizing {
    user-select: none;
    pointer-events: none;
  }

  .terminal-panel.is-resizing :global(*) {
    pointer-events: none;
  }
</style>

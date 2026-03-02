<script lang="ts">
  /**
   * QuakeTerminalOverlay - A sleek, Quake-style terminal overlay
   *
   * Features:
   * - Always-visible tab bar at bottom when terminals exist
   * - Smooth slide-up animation for terminal panel
   * - Multiple terminal tabs with close buttons
   * - Drag-to-resize handle
   * - Keyboard shortcuts (Ctrl+`, Cmd+J, Cmd+Shift+N, Cmd+W, Cmd+Shift+[/])
   * - Double-click to rename tabs
   * - Persisted height and custom names
   */
  import { fly, slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { terminalOverlayStore } from '$lib/stores/terminal-overlay.store.svelte';
  import Terminal from './Terminal.svelte';
  import SetupScriptBanner from './SetupScriptBanner.svelte';
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faXmark,
    faChevronDown,
    faChevronUp,
    faTerminal,
    faBan,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Button from '$lib/components/ui/button/button.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { track } from '$lib/services/analytics';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  // ============================================================================
  // Props & State
  // ============================================================================

  interface Props {
    workspaceId?: WorkspaceId;
  }

  let { workspaceId: propWorkspaceId }: Props = $props();

  // Store bindings
  const isOpen = $derived(terminalOverlayStore.isOpen);
  const height = $derived(terminalOverlayStore.height);
  const storeWorkspaceId = $derived(terminalOverlayStore.workspaceId);
  const activeTerminalId = $derived(terminalOverlayStore.activeTerminalId);
  const terminals = $derived(terminalOverlayStore.terminals);

  // Computed workspace ID (prop takes priority)
  const workspaceId = $derived(propWorkspaceId || storeWorkspaceId);

  // UI state
  let isResizing = $state(false);
  let editingTerminalId = $state<string | null>(null);
  let editingValue = $state('');
  let isEditingHeaderName = $state(false);
  let headerEditValue = $state('');

  // Constants
  const TAB_BAR_HEIGHT = 36; // h-9 = 2.25rem = 36px

  // ============================================================================
  // Effects
  // ============================================================================

  // Sync workspace ID to store (also loads terminals for the new workspace)
  $effect(() => {
    if (propWorkspaceId && propWorkspaceId !== storeWorkspaceId) {
      terminalOverlayStore.setWorkspace(propWorkspaceId);
    }
  });

  // Update CSS custom property for layout bottom padding
  $effect(() => {
    if (typeof document === 'undefined') return;

    const hasTerminals = workspaceId && terminals.length > 0;
    const terminalIsOpen = isOpen && activeTerminalId;
    const terminalHeight = height;

    function updateLayoutHeight() {
      let totalHeight = 0;
      if (hasTerminals) {
        totalHeight = TAB_BAR_HEIGHT;
        if (terminalIsOpen) {
          totalHeight += (terminalHeight / 100) * window.innerHeight;
        }
      }
      document.documentElement.style.setProperty('--terminal-overlay-height', `${totalHeight}px`);
    }

    updateLayoutHeight();
    window.addEventListener('resize', updateLayoutHeight);

    return () => {
      window.removeEventListener('resize', updateLayoutHeight);
      document.documentElement.style.removeProperty('--terminal-overlay-height');
    };
  });

  // Listen for custom events from terminal adapter (when terminal has focus)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const wsId = workspaceId;

    function handleToggle() {
      if (wsId) {
        terminalOverlayStore.toggle(wsId);
      }
    }

    function handleCreateNew() {
      createNewTerminal();
    }

    window.addEventListener('terminal:toggle-overlay', handleToggle);
    window.addEventListener('terminal:create-new', handleCreateNew);

    return () => {
      window.removeEventListener('terminal:toggle-overlay', handleToggle);
      window.removeEventListener('terminal:create-new', handleCreateNew);
    };
  });

  // ============================================================================
  // Tab Display Logic
  // ============================================================================

  function getTabDisplayName(term: { id: string; name: string; customName?: string }): string {
    if (term.customName) return term.customName;
    const lastCommand = terminalHistoryTracker.getLastCommand(term.id);
    if (lastCommand) {
      // Truncate long commands
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
      terminalOverlayStore.renameTerminal(editingTerminalId, editingValue);
      editingTerminalId = null;
      editingValue = '';
    }
  }

  function cancelEditing() {
    editingTerminalId = null;
    editingValue = '';
  }

  // Header name editing
  function startEditingHeaderName() {
    if (!activeTerminalId) return;
    const term = terminals.find((t) => t.id === activeTerminalId);
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
    if (isEditingHeaderName && activeTerminalId) {
      terminalOverlayStore.renameTerminal(activeTerminalId, headerEditValue);
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

  function handleEditKeydown(e: KeyboardEvent) {
    e.stopPropagation(); // Prevent parent tab from handling keydown
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }

  // ============================================================================
  // Terminal Actions
  // ============================================================================

  function handleClose() {
    terminalOverlayStore.close();
  }

  function handleOpen() {
    if (workspaceId) {
      terminalOverlayStore.open(workspaceId);
    }
  }

  function createNewTerminal() {
    if (!workspaceId) return;
    const newId = `terminal-${Date.now()}`;
    terminalOverlayStore.addTerminal(newId, `Terminal ${terminals.length + 1}`);
    if (!isOpen) {
      terminalOverlayStore.open(workspaceId, newId);
    }
    track('Opened Terminal', { workspace_id: workspaceId, source: 'bottom-bar' });
  }

  function closeTerminal(termId: string, e?: MouseEvent) {
    e?.stopPropagation();
    terminalOverlayStore.removeTerminal(termId);
    terminalManager.disposeTerminal(termId);
  }

  function clearActiveTerminal() {
    if (activeTerminalId) {
      terminalManager.clearTerminal(activeTerminalId);
    }
  }

  // Track pending single click to differentiate from double-click
  let pendingClickTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleTabClick(termId: string) {
    // Clear any pending click to prevent toggle on double-click
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }

    // Delay single-click action to allow double-click to cancel it
    pendingClickTimeout = setTimeout(() => {
      pendingClickTimeout = null;
      if (termId === activeTerminalId && isOpen) {
        handleClose();
      } else {
        terminalOverlayStore.selectTerminal(termId);
        if (!isOpen && workspaceId) {
          terminalOverlayStore.open(workspaceId, termId);
        }
      }
    }, 200);
  }

  function handleTabDoubleClick(termId: string, customName: string | undefined, e: MouseEvent) {
    e.stopPropagation();
    // Cancel pending single-click action
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }
    startEditing(termId, customName || '');
  }

  function cycleTerminal(direction: 1 | -1) {
    if (!activeTerminalId || terminals.length <= 1) return;
    const currentIndex = terminals.findIndex((t) => t.id === activeTerminalId);
    const nextIndex = (currentIndex + direction + terminals.length) % terminals.length;
    terminalOverlayStore.selectTerminal(terminals[nextIndex].id);
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
    terminalOverlayStore.setHeight(newHeight);
  }

  function stopResize() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  function handleKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;

    // Note: Cmd+` is reserved for native macOS window cycling; use Ctrl+` or Cmd+J for terminal toggle

    // Only handle tab cycling when terminal is open
    if (!isOpen) return;

    // Tab cycling shortcuts (Cmd+Shift+[/]) should only work when focus is in the terminal
    // This prevents conflicts with panel cycling shortcuts in PanelLayout
    const isTerminalFocused = isFocusInTerminal(event.target as HTMLElement | null);
    if (!isTerminalFocused) return;

    // Tab cycling (only with multiple terminals)
    if (terminals.length <= 1) return;

    // Cmd+Shift+] - Next terminal
    // Note: Shift+] produces } on US keyboards, so we check for both
    if ((event.key === ']' || event.key === '}') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation(); // Prevent panel handler from also firing
      cycleTerminal(1);
      return;
    }

    // Cmd+Shift+[ - Previous terminal
    // Note: Shift+[ produces { on US keyboards, so we check for both
    if ((event.key === '[' || event.key === '{') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation(); // Prevent panel handler from also firing
      cycleTerminal(-1);
      return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if workspaceId}
  <!-- Terminal Overlay Container - rendered within layout's terminal-overlay-container -->
  <div class="terminal-overlay flex flex-col w-full">
    <!-- Expanded Terminal Panel -->
    {#if isOpen && activeTerminalId}
      <div
        class="terminal-panel relative flex flex-col bg-sidebar border-t border-border shadow-2xl w-full"
        class:is-resizing={isResizing}
        style="height: {height}vh;"
        transition:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
      >
        <!-- Resize Handle - Sleek minimal design -->
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
                class="text-sm font-medium bg-transparent border-0 outline-none focus:outline-none! focus:ring-0! px-0 w-40 text-foreground/80"
                placeholder="Terminal name"
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="text-sm font-medium text-foreground/80 cursor-pointer hover:text-foreground transition-colors"
                onclick={startEditingHeaderName}
                ondblclick={startEditingHeaderName}
                title="Click to rename terminal"
              >
                {terminals.find((t) => t.id === activeTerminalId)?.customName ||
                  terminals.find((t) => t.id === activeTerminalId)?.name ||
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
              tooltipShortcut="mod+`"
              aria-label="Collapse terminal"
            >
              <Fa icon={faChevronDown} size="xs" />
            </Button>
          </div>
        </div>

        <!-- Terminal Content + Setup Script Editor -->
        <div class="flex-1 flex flex-col min-h-0 relative overflow-hidden">
          <!-- Terminal Content -->
          <div class="flex-1 overflow-hidden">
            {#key activeTerminalId}
              <Terminal terminalId={activeTerminalId} {workspaceId} class="h-full w-full" />
            {/key}
          </div>

          <!-- Setup Script Banner - horizontal bar at bottom -->
          {#if workspaceId}
            <SetupScriptBanner {workspaceId} />
          {/if}
        </div>
      </div>
    {/if}

    <!-- Tab Bar - Always visible when terminals exist -->
    <div class="flex items-center justify-between h-9 px-1 bg-background backdrop-blur-xl">
      <!-- Tabs Container -->
      <div class="flex items-center h-full min-w-0 overflow-x-auto scrollbar-none">
        <!-- Terminal Icon -->
        <div class="pl-2 pr-3">
          <Fa icon={faTerminal} class="shrink-0 w-3.5 h-3.5 opacity-60" />
        </div>

        {#each terminals as term (term.id)}
          {@const isActive = term.id === activeTerminalId && isOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={cn(
              'flex items-center gap-1.5 h-full px-2.5 text-sm font-medium text-subtle cursor-pointer transition-all duration-150 min-w-0 max-w-90 whitespace-nowrap border-x border-border -ml-px group/tab',
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
            <!-- Tab Label (editable) -->
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

            <!-- Close Button - appears on hover -->
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

        <!-- New Terminal Button -->
        <Tooltip content="New Terminal (⌘⇧N)" side="top" delayDuration={300}>
          <button
            type="button"
            class="flex items-center justify-center w-7 h-7 ml-1 border-none rounded-md bg-transparent text-muted-foreground cursor-pointer transition-all duration-150 hover:bg-muted/80 hover:text-foreground"
            onclick={createNewTerminal}
            aria-label="New terminal"
          >
            <Fa icon={faPlus} class="size-2.75" />
          </button>
        </Tooltip>
      </div>

      <!-- Right Actions -->
      <div class="flex items-center gap-0.5 pl-2">
        <!-- Collapse/Expand Toggle -->
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => (isOpen ? handleClose() : handleOpen())}
          tooltip={isOpen ? 'Collapse Terminal' : 'Expand Terminal'}
          tooltipShortcut="mod+`"
          aria-label={isOpen ? 'Collapse terminal' : 'Expand terminal'}
        >
          <Fa icon={isOpen ? faChevronDown : faChevronUp} size="xs" />
        </Button>
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

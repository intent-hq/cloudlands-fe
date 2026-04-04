<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount, onDestroy } from 'svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import type { TerminalAdapter } from '$features/terminal/TerminalAdapter';
  import TerminalSearchBar from './TerminalSearchBar.svelte';

  interface Props {
    terminalId: string;
    workspaceId: string;
    class?: string;
    onStatusChange?: (status: { isConnected: boolean; isExecuting: boolean }) => void;
  }

  let { terminalId, workspaceId, class: className = '', onStatusChange }: Props = $props();

  let container: HTMLDivElement;
  let terminal: TerminalAdapter | null = null;
  let isConnected = $state(false);
  let isExecuting = $state(false);

  // Search state
  let searchOpen = $state(false);
  let hasMatches = $state(true);
  let searchFocusTrigger = $state(0);
  let currentMatchIndex = $state(-1);
  let totalMatches = $state(0);

  // Theme change listener cleanup function - set on mount
  let themeCleanup: (() => void) | undefined;

  // Track theme changes

  // Track previous status to avoid unnecessary updates
  let previousStatus = { isConnected: false, isExecuting: false };

  // Notify parent of status changes only when they actually change
  $effect(() => {
    if (previousStatus.isConnected !== isConnected || previousStatus.isExecuting !== isExecuting) {
      previousStatus = { isConnected, isExecuting };
      onStatusChange?.({ isConnected, isExecuting });
    }
  });

  // Listen for terminal:toggle-search event from TerminalAdapter
  $effect(() => {
    if (typeof window === 'undefined') return;

    function handleToggleSearch(e: CustomEvent<{ terminalId: string }>) {
      // Only respond if this event is for our terminal
      if (e.detail?.terminalId !== terminalId) return;

      if (searchOpen) {
        // Already open - close it
        handleSearchClose();
      } else {
        searchOpen = true;
      }
    }

    window.addEventListener('terminal:toggle-search', handleToggleSearch as EventListener);

    return () => {
      window.removeEventListener('terminal:toggle-search', handleToggleSearch as EventListener);
    };
  });

  /**
   * Load terminal
   */
  async function loadTerminal(id: string) {
    try {
      isConnected = false;

      if (!container) {
        logger.error('Terminal container not ready');
        return;
      }

      // Validate terminal ID
      if (!id) {
        logger.error('Invalid terminal ID: empty or null');
        return;
      }

      // Warn if terminal ID looks like an agent ID
      if (id.startsWith('agent-')) {
        logger.warn('Terminal ID appears to be an agent ID', { terminalId: id });
        // Still try to load it, but it will likely fail
      }

      terminal = await terminalManager.getOrCreateTerminal(
        id,
        workspaceId,
        container,
        {
          onReady: () => {
            isConnected = true;
            // Auto-focus the terminal when it's ready
            requestAnimationFrame(() => {
              terminal?.focus();
            });
          },
          onCommandStart: () => {
            isExecuting = true;
          },
          onCommandFinished: () => {
            isExecuting = false;
          },
          onSearchResultsChange: (resultIndex, resultCount) => {
            currentMatchIndex = resultIndex;
            totalMatches = resultCount;
            hasMatches = resultCount > 0;
          },
        },
        false, // Never force new - let the manager decide based on whether it exists
      );
    } catch (error) {
      logger.error('Failed to load terminal:', error);
    }
  }

  let lastLoadedId: string | null = null;

  // Search handlers
  function handleFindNext(query: string) {
    if (terminal && query) {
      const found = terminal.findNext(query);
      hasMatches = found;
    }
  }

  function handleFindPrevious(query: string) {
    if (terminal && query) {
      const found = terminal.findPrevious(query);
      hasMatches = found;
    }
  }

  function handleSearchClose() {
    searchOpen = false;
    hasMatches = true; // Reset to avoid stale "No results" state
    currentMatchIndex = -1;
    totalMatches = 0;
    terminal?.clearSearch();
    terminal?.focus();
  }

  onMount(() => {
    logger.info('[Terminal] onMount', { terminalId, hasContainer: !!container });
    if (container && terminalId && lastLoadedId !== terminalId) {
      lastLoadedId = terminalId;
      loadTerminal(terminalId);
    }
  });

  onDestroy(() => {
    logger.info('[Terminal] onDestroy', { terminalId });
    // Clean up theme listeners
    themeCleanup?.();

    // Detach terminal from container (keeps it alive in the manager for reattachment)
    if (terminalId) {
      terminalManager.detachTerminal(terminalId);
    }
    lastLoadedId = null;
  });

  // React to terminal ID changes
  $effect(() => {
    if (container && terminalId && lastLoadedId !== terminalId) {
      // Detach the old terminal first if switching terminals
      if (lastLoadedId) {
        terminalManager.detachTerminal(lastLoadedId);
      }
      lastLoadedId = terminalId;
      loadTerminal(terminalId);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="terminal-container {className}">
  <!-- Search bar - positioned absolutely in top-right -->
  {#if searchOpen}
    <TerminalSearchBar
      isOpen={searchOpen}
      {hasMatches}
      {currentMatchIndex}
      {totalMatches}
      focusTrigger={searchFocusTrigger}
      onFindNext={handleFindNext}
      onFindPrevious={handleFindPrevious}
      onClose={handleSearchClose}
    />
  {/if}

  <!-- Terminal content -->
  <div class="terminal-content" bind:this={container}></div>
</div>

<style>
  .terminal-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    position: relative;
    overflow: hidden;
  }

  /* Terminal content */
  .terminal-content {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  /* Loading state */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: rgba(0, 0, 0, 0.5); /* Light mode text */
  }

  /* Dark mode loading text */
  :global(.dark) .loading {
    color: rgba(255, 255, 255, 0.5);
  }

  /* XTerm styles */
  :global(.terminal-content .xterm) {
    height: 100%;
    padding: 8px;
  }

  /*
   * Anti-aliasing fix for light themes
   * On light backgrounds, subpixel-antialiased renders text sharper than antialiased.
   * The Canvas renderer (used for light themes) respects CSS font-smoothing.
   * We target html.light explicitly since the theme manager adds both dark/light classes to document.documentElement.
   */
  :global(html.light .terminal-content .xterm) {
    -webkit-font-smoothing: subpixel-antialiased;
    -moz-osx-font-smoothing: auto;
  }

  /* Dark mode uses grayscale antialiasing which looks better on dark backgrounds */
  :global(.dark .terminal-content .xterm) {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Light mode scrollbar */
  :global(.terminal-content .xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
  }

  /* Dark mode scrollbar */
  :global(.dark .terminal-content .xterm-viewport) {
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  :global(.terminal-content .xterm-viewport::-webkit-scrollbar) {
    width: 8px;
  }

  :global(.terminal-content .xterm-viewport::-webkit-scrollbar-track) {
    background: transparent;
  }

  /* Light mode scrollbar thumb */
  :global(.terminal-content .xterm-viewport::-webkit-scrollbar-thumb) {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }

  :global(.terminal-content .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: rgba(0, 0, 0, 0.3);
  }

  /* Dark mode scrollbar thumb */
  :global(.dark .terminal-content .xterm-viewport::-webkit-scrollbar-thumb) {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  :global(.dark .terminal-content .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Animations */
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes processPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>

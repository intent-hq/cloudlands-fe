/**
 * useDockNavigation Composable
 *
 * Manages dock navigation keyboard shortcuts for navigating between agents and terminals.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 *
 * Keyboard shortcuts:
 * - Alt+Up / Alt+Down: Cycle through dock items (agents/terminals)
 * - Cmd+ArrowUp / Cmd+ArrowDown: Navigate messages in conversation
 * - Ctrl+Shift+`: Create new terminal
 * Note: Cmd+N (New Space) and Cmd+T (New Agent) are handled by the Electron menu
 *
 * Note: Ctrl+` (toggle terminal) is handled globally in +layout.svelte
 * Note: Cmd+[ / Cmd+] are handled by panel-keyboard-shortcuts.svelte.ts
 */

import type { AgentSession } from '$shared/types';
import type { UnifiedWorkspaceState } from '$features/workspace/workspace-unified-state.svelte';
import type { UnifiedWorkspaceStateManager } from '$features/workspace/workspace-unified-state.svelte';
import { createLogger } from '$lib/utils/client-logger';
import { isFocusInEditableElement } from '$lib/utils/keyboardShortcuts';

const logger = createLogger('DockNavigation');

// Local Terminal type for UI representation
interface Terminal {
  id: string;
  type: 'terminal';
  title: string;
  workspaceId: string;
  createdAt: string;
  isConnected?: boolean;
  isExecuting?: boolean;
}

export interface UseDockNavigationOptions {
  agents: AgentSession[];
  terminals: Terminal[];
  state: UnifiedWorkspaceState | null;
  stateManager?: UnifiedWorkspaceStateManager | null;
  workspaceId?: string;
  onOpenAgent: (agentId: string) => void;
  onOpenTerminal: (terminalId: string) => void;
  onCloseDrawer?: () => void;
  onCreateAgent?: () => void;
  onCreateTerminal?: () => void;
  /**
   * Optional function to check if the currently open agent is streaming.
   * When true, dock navigation (Alt+Up/Down) will be blocked to prevent
   * accidentally switching away from a streaming agent.
   */
  isCurrentAgentStreaming?: () => boolean;
}

export function useDockNavigation(options: UseDockNavigationOptions) {
  /**
   * Get all dock items in order: agents first, then terminals
   * This matches the visual order in the vertical dock
   */
  function getDockItems(): Array<{ id: string; type: 'agent' | 'terminal' }> {
    const items: Array<{ id: string; type: 'agent' | 'terminal' }> = [];

    // Add agents (filter background agents same as WorkspaceDock does)
    for (const agent of options.agents) {
      if (!agent.isBackground && !agent.metadata?.isBackground) {
        items.push({ id: agent.id, type: 'agent' });
      }
    }

    // Add terminals
    for (const terminal of options.terminals) {
      items.push({ id: terminal.id, type: 'terminal' });
    }

    return items;
  }

  /**
   * Navigate to the next or previous dock item
   */
  function navigateDock(direction: 'next' | 'previous') {
    // Block navigation if current agent is streaming to prevent accidental switches
    if (options.isCurrentAgentStreaming?.()) {
      logger.debug('Blocking dock navigation - current agent is streaming');
      return;
    }

    const items = getDockItems();
    if (items.length === 0) return;

    // Find current item index
    const currentId = options.state?.drawer?.itemId;
    const currentType = options.state?.drawer?.type;
    let currentIndex = -1;

    if (currentId && currentType && (currentType === 'agent' || currentType === 'terminal')) {
      currentIndex = items.findIndex((item) => item.id === currentId && item.type === currentType);
    }

    // Calculate next index with wrapping
    let nextIndex: number;
    if (currentIndex === -1) {
      // No current selection, start at first or last
      nextIndex = direction === 'next' ? 0 : items.length - 1;
    } else if (direction === 'next') {
      nextIndex = (currentIndex + 1) % items.length;
    } else {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    }

    // Open the next item
    const nextItem = items[nextIndex];
    if (nextItem.type === 'agent') {
      options.onOpenAgent(nextItem.id);
    } else {
      options.onOpenTerminal(nextItem.id);
    }
  }

  // Set up keyboard shortcuts for dock navigation
  $effect(() => {
    if (typeof window === 'undefined') return;

    // Detect if we're on Mac (check once, not on every keydown)
    const isMac =
      // @ts-expect-error - userAgentData is not in all browsers
      navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

    const handleKeydown = (event: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // Alt/Option key for dock cycling (Up/Down) and workspace navigation (Left/Right)
      // Don't trigger if user is focused in an editable element
      // Note: Cmd+Left/Right browser navigation is handled at the app layout level
      if (event.altKey && !cmdOrCtrl && !event.shiftKey) {
        const target = event.target as HTMLElement;

        // Skip navigation shortcuts when focused in editable elements
        if (isFocusInEditableElement(target)) {
          return;
        }

        // Alt + Up/Down = Cycle through dock items (agents/terminals)
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          navigateDock('previous');
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          navigateDock('next');
          return;
        }
      }

      // Note: Ctrl+` (toggle terminal) is handled globally in +layout.svelte
      // to avoid duplicate handlers. Only handle Ctrl+Shift+` here for creating new terminals.
      // When Shift is held with backtick, the key becomes '~' (tilde)
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === '~' || (event.shiftKey && event.key === '`'))
      ) {
        event.preventDefault();
        event.stopPropagation();
        // Ctrl+Shift+` = Create new terminal
        options.onCreateTerminal?.();
        return;
      }

      // Cmd/Ctrl shortcuts
      if (!cmdOrCtrl) return;

      // NOTE: Cmd+[ / Cmd+] are now handled by panel-keyboard-shortcuts.svelte.ts
      // for panel layout history navigation

      // Cmd/Ctrl + N is handled by the Electron menu (New Space modal)
      // Cmd/Ctrl + T is handled by the Electron menu (New Agent)

      // Cmd/Ctrl + ArrowUp/ArrowDown = Navigate messages (NOT when in input)
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const target = event.target as HTMLElement;
        const isInInput =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        if (isInInput) return;

        event.preventDefault();

        // Dispatch event for message navigation in the conversation
        const direction = event.key === 'ArrowUp' ? 'previous' : 'next';
        window.dispatchEvent(new CustomEvent('navigate-message', { detail: { direction } }));
        return;
      }
    };

    // Use capture phase to intercept events before xterm.js processes them
    window.addEventListener('keydown', handleKeydown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeydown, { capture: true });
    };
  });

  return {
    // Methods
    getDockItems,
    navigateDock,
    navigateNext: () => navigateDock('next'),
    navigatePrevious: () => navigateDock('previous'),
  };
}

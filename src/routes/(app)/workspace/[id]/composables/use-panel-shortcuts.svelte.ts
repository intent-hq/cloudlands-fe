/**
 * usePanelShortcuts Composable
 *
 * Manages keyboard shortcuts for panel navigation and manipulation.
 * Inspired by VS Code, tmux, and Vim keybindings.
 *
 * Keyboard shortcuts:
 * - Cmd+0: Native browser zoom reset (not intercepted)
 * - Cmd+O: Toggle spaces overlay
 * - Cmd+Shift+D: Open Agent Overview
 * - Cmd+Shift+E: Switch to Files tab
 * - Cmd+Shift+G: Switch to Changes tab
 * - Cmd+Shift+N: Switch to Notes tab
 * - Cmd+Shift+A: Switch to Activity tab
 * - Cmd+Shift+M: Maximize/restore panel (toggle focus mode)
 * - Cmd+Alt+1/2/3: Layout presets (focus/split/full)
 *
 * Note: Panel-specific shortcuts are in panel-keyboard-shortcuts.svelte.ts:
 * - Mod+PageUp/PageDown: Select the previous/next pane
 * - Mod+Shift+PageUp/PageDown: Focus the previous/next column
 * - Mod+Alt+PageUp/PageDown: Move the active pane between columns
 * - Mod+\: Create a column to the right
 */

import { createLogger } from '$lib/utils/client-logger';
const logger = createLogger('PanelShortcuts');

export interface UsePanelShortcutsOptions {
  enabled?: boolean;
  onToggleSidebar?: () => void;
  onOpenAgentOverview?: () => void;
  onFocusSidebar?: () => void;
  onFocusMainContent?: () => void;
  onFocusDrawer?: () => void;
  onFocusDock?: () => void;
  onFocusExplorer?: () => void;
  onFocusGit?: () => void;
  onFocusNotes?: () => void;
  onFocusActivity?: () => void;
  onMaximizePanel?: () => void;
  onLayoutFocus?: () => void;
  onLayoutSplit?: () => void;
  onLayoutFull?: () => void;
}

export function usePanelShortcuts(options: UsePanelShortcutsOptions) {
  $effect(() => {
    if (typeof window === 'undefined') return;
    if (options.enabled === false) return;

    const isMac =
      // @ts-expect-error - userAgentData is not in all browsers
      navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

    const handleKeydown = (event: KeyboardEvent) => {
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // Only handle if cmd/ctrl is pressed
      if (!cmdOrCtrl) return;

      // All panel shortcuts are "global" - they work even in inputs
      // because they're for navigation, not text editing.
      // These shortcuts intentionally use Cmd+Shift or Cmd+Alt to avoid
      // conflicting with text editing shortcuts like Cmd+B (bold) in rich text editors.

      // Cmd+0: Let browser handle native zoom reset (don't intercept)

      // Cmd+Shift+D: Open Agent Overview
      if ((event.key === 'd' || event.key === 'D') && event.shiftKey && !event.altKey) {
        event.preventDefault();
        logger.debug('Opening agent overview');
        options.onOpenAgentOverview?.();
        return;
      }

      // Cmd+Shift+E: Focus explorer (files tab)
      if ((event.key === 'e' || event.key === 'E') && event.shiftKey && !event.altKey) {
        event.preventDefault();
        logger.debug('Focusing files tab');
        options.onFocusExplorer?.();
        return;
      }

      // Cmd+Shift+G: Focus git/code changes tab
      if ((event.key === 'g' || event.key === 'G') && event.shiftKey && !event.altKey) {
        event.preventDefault();
        logger.debug('Focusing changes tab');
        options.onFocusGit?.();
        return;
      }

      // Note: Cmd+Shift+N is reserved for New Window (handled by native menu)

      // Cmd+Shift+A: Focus activity tab
      if ((event.key === 'a' || event.key === 'A') && event.shiftKey && !event.altKey) {
        event.preventDefault();
        logger.debug('Focusing activity tab');
        options.onFocusActivity?.();
        return;
      }

      // Cmd+Shift+M: Maximize panel
      if ((event.key === 'm' || event.key === 'M') && event.shiftKey && !event.altKey) {
        event.preventDefault();
        logger.debug('Maximizing panel');
        options.onMaximizePanel?.();
        return;
      }

      // Layout presets (Cmd+Alt+1/2/3)
      if (event.altKey && !event.shiftKey) {
        if (event.key === '1') {
          event.preventDefault();
          logger.debug('Switching to focus layout');
          options.onLayoutFocus?.();
          return;
        }
        if (event.key === '2') {
          event.preventDefault();
          logger.debug('Switching to split layout');
          options.onLayoutSplit?.();
          return;
        }
        if (event.key === '3') {
          event.preventDefault();
          logger.debug('Switching to full layout');
          options.onLayoutFull?.();
          return;
        }
      }
    };

    logger.debug('Panel shortcuts effect running, attaching keydown listener');
    window.addEventListener('keydown', handleKeydown, true); // Use capture to get events first
    return () => {
      logger.debug('Panel shortcuts effect cleanup, removing keydown listener');
      window.removeEventListener('keydown', handleKeydown, true);
    };
  });

  return {};
}

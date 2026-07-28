/**
 * Centralized Keyboard Shortcuts Registry
 *
 * Single source of truth for all keyboard shortcuts in the app.
 * Provides consistent formatting for tooltips and documentation.
 * Labels/titles use property getters so they re-resolve on locale change.
 */
import { m } from '$shared/paraglide/messages.js';

// Detect platform once
const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Shortcut category for organizing the cheat sheet
 */
export type ShortcutCategory = 'global' | 'navigation' | 'chat' | 'editor' | 'panel' | 'leader';

/**
 * Context for determining which shortcuts to show
 */
export type ShortcutContext =
  | 'global' // Always shown
  | 'chat' // When focused on chat/agent
  | 'editor' // When editing a file or note
  | 'panel' // Panel navigation
  | 'terminal'; // When terminal is focused

/**
 * Format a shortcut for display in tooltips
 * Uses platform-appropriate symbols (⌘ for Mac, Ctrl for Windows/Linux)
 */
export function formatShortcut(shortcut: string | string[]): string {
  if (Array.isArray(shortcut)) {
    return shortcut.map(formatSingleKey).join(' ');
  }
  return shortcut
    .split('+')
    .map((k) => formatSingleKey(k.trim()))
    .join(isMac ? '' : '+');
}

function formatSingleKey(key: string): string {
  const lower = key.toLowerCase();

  // Modifier keys
  if (lower === 'cmd' || lower === 'meta' || lower === 'mod') {
    return isMac ? '⌘' : 'Ctrl';
  }
  if (lower === 'ctrl' || lower === 'control') {
    return isMac ? '⌃' : 'Ctrl';
  }
  if (lower === 'alt' || lower === 'option') {
    return isMac ? '⌥' : 'Alt';
  }
  if (lower === 'shift') {
    return isMac ? '⇧' : 'Shift';
  }

  // Special keys
  if (lower === 'enter' || lower === 'return') return '↵';
  if (lower === 'esc' || lower === 'escape') return 'Esc';
  if (lower === 'tab') return '⇥';
  if (lower === 'backspace') return '⌫';
  if (lower === 'delete') return '⌦';
  if (lower === 'space') return '␣';
  if (lower === 'up' || lower === 'arrowup') return '↑';
  if (lower === 'down' || lower === 'arrowdown') return '↓';
  if (lower === 'left' || lower === 'arrowleft') return '←';
  if (lower === 'right' || lower === 'arrowright') return '→';
  if (lower === 'pageup') return 'PgUp';
  if (lower === 'pagedown') return 'PgDn';

  // Bracket keys
  if (key === '[') return '[';
  if (key === ']') return ']';

  // Regular keys - capitalize
  return key.toUpperCase();
}

/**
 * All application keyboard shortcuts
 * Organized by category for easy reference
 */
export const SHORTCUTS = {
  // ============================================================================
  // Global / Navigation
  // ============================================================================
  COMMAND_PALETTE: {
    key: 'mod+shift+p',
    get label() {
      return m.ui_shortcuts_commandPalette_label();
    },
  },
  SETTINGS: {
    key: 'mod+,',
    get label() {
      return m.ui_shortcuts_settings_label();
    },
  },
  NEW_TAB: {
    key: 'mod+t',
    get label() {
      return m.ui_shortcuts_newTab_label();
    },
  },
  REOPEN_TAB: {
    key: 'mod+shift+t',
    get label() {
      return m.ui_shortcuts_reopenTab_label();
    },
  },
  CLOSE_TAB: {
    key: 'mod+w',
    get label() {
      return m.ui_shortcuts_closeTab_label();
    },
  },
  GO_BACK: {
    key: 'mod+[ / mod+←',
    get label() {
      return m.ui_shortcuts_goBack_label();
    },
  },
  GO_FORWARD: {
    key: 'mod+] / mod+→',
    get label() {
      return m.ui_shortcuts_goForward_label();
    },
  },
  TAB_1_9: {
    key: 'mod+1-9',
    get label() {
      return m.ui_shortcuts_goToTab_label();
    },
  },
  SEARCH: {
    key: 'mod+f',
    get label() {
      return m.ui_shortcuts_search_label();
    },
  },

  // ============================================================================
  // Dock / Agent Navigation
  // ============================================================================
  NEW_AGENT: {
    key: 'mod+n',
    get label() {
      return m.ui_shortcuts_newAgent_label();
    },
  },

  // ============================================================================
  // Chat / Input
  // ============================================================================
  SEND: {
    key: 'enter',
    get label() {
      return m.ui_shortcuts_sendMessage_label();
    },
  },
  FORCE_SEND: {
    key: 'mod+enter',
    get label() {
      return m.ui_shortcuts_forceSend_label();
    },
  },
  NEW_LINE: {
    key: 'shift+enter',
    get label() {
      return m.ui_shortcuts_newLine_label();
    },
  },
  STOP: {
    key: 'esc',
    get label() {
      return m.ui_shortcuts_stopGeneration_label();
    },
  },
  FOCUS_INPUT: {
    key: '/',
    get label() {
      return m.ui_shortcuts_focusInput_label();
    },
  },

  // ============================================================================
  // Message Actions
  // ============================================================================
  COPY: {
    key: 'mod+c',
    get label() {
      return m.ui_shortcuts_copy_label();
    },
  },
  EDIT: {
    key: 'e',
    get label() {
      return m.ui_shortcuts_edit_label();
    },
  },
  REGENERATE: {
    key: 'r',
    get label() {
      return m.ui_shortcuts_regenerate_label();
    },
  },

  // ============================================================================
  // File / Editor
  // ============================================================================
  GO_TO_LINE: {
    key: 'mod+g',
    get label() {
      return m.ui_shortcuts_goToLine_label();
    },
  },
  SAVE: {
    key: 'mod+s',
    get label() {
      return m.ui_shortcuts_save_label();
    },
  },
  UNDO: {
    key: 'mod+z',
    get label() {
      return m.ui_shortcuts_undo_label();
    },
  },
  REDO: {
    key: 'mod+shift+z',
    get label() {
      return m.ui_shortcuts_redo_label();
    },
  },
  TOGGLE_TASK_LIST: {
    key: 'mod+shift+9',
    get label() {
      return m.ui_shortcuts_toggleTaskList_label();
    },
  },
  TOGGLE_WORD_WRAP: {
    key: 'alt+z',
    get label() {
      return m.ui_shortcuts_toggleWordWrap_label();
    },
  },

  // ============================================================================
  // Follow Mode
  // ============================================================================
  TOGGLE_FOLLOW: {
    key: 'mod+shift+f',
    get label() {
      return m.ui_shortcuts_toggleFollow_label();
    },
  },
  NEXT_AGENT_FOLLOW: {
    key: 'mod+shift+right',
    get label() {
      return m.ui_shortcuts_followNextAgent_label();
    },
  },
  PREV_AGENT_FOLLOW: {
    key: 'mod+shift+left',
    get label() {
      return m.ui_shortcuts_followPrevAgent_label();
    },
  },
  EXIT_FOLLOW: {
    key: 'esc',
    get label() {
      return m.ui_shortcuts_exitFollow_label();
    },
  },

  // ============================================================================
  // Miscellaneous
  // ============================================================================
  CANCEL: {
    key: 'esc',
    get label() {
      return m.ui_shortcuts_cancel_label();
    },
  },
  CONFIRM: {
    key: 'enter',
    get label() {
      return m.ui_shortcuts_confirm_label();
    },
  },
  SELECT_ALL: {
    key: 'mod+a',
    get label() {
      return m.ui_shortcuts_selectAll_label();
    },
  },

  // ============================================================================
  // Panel Navigation (VS Code-inspired)
  // ============================================================================
  // Note: Cmd+0 is reserved for native browser zoom reset
  FOCUS_MAIN_CONTENT: {
    key: 'mod+1',
    get label() {
      return m.ui_shortcuts_focusMainContent_label();
    },
  },
  FOCUS_DRAWER: {
    key: 'mod+2',
    get label() {
      return m.ui_shortcuts_focusDrawer_label();
    },
  },
  FOCUS_DOCK: {
    key: 'mod+3',
    get label() {
      return m.ui_shortcuts_focusDock_label();
    },
  },

  // ============================================================================
  // Panel Visibility
  // ============================================================================
  TOGGLE_SIDEBAR: {
    key: 'mod+b',
    get label() {
      return m.ui_shortcuts_toggleSidebar_label();
    },
  },
  TOGGLE_DRAWER: {
    key: 'mod+shift+d',
    get label() {
      return m.ui_shortcuts_toggleDrawer_label();
    },
  },

  // ============================================================================
  // Quick Panel Focus (VS Code Activity Bar style)
  // ============================================================================
  FOCUS_EXPLORER: {
    key: 'mod+shift+e',
    get label() {
      return m.ui_shortcuts_focusExplorer_label();
    },
  },
  FOCUS_GIT: {
    key: 'mod+shift+g',
    get label() {
      return m.ui_shortcuts_focusGit_label();
    },
  },
  FOCUS_NOTES: {
    key: 'mod+shift+n',
    get label() {
      return m.ui_shortcuts_focusNotes_label();
    },
  },
  FOCUS_ACTIVITY: {
    key: 'mod+shift+a',
    get label() {
      return m.ui_shortcuts_focusActivity_label();
    },
  },

  // ============================================================================
  // Panel Manipulation
  // ============================================================================
  MAXIMIZE_PANEL: {
    key: 'mod+shift+m',
    get label() {
      return m.ui_shortcuts_maximizePanel_label();
    },
  },
  EQUALIZE_PANELS: {
    key: 'mod+alt+=',
    get label() {
      return m.ui_shortcuts_equalizePanels_label();
    },
  },
  RESIZE_PANEL_LEFT: {
    key: 'mod+alt+left',
    get label() {
      return m.ui_shortcuts_shrinkPanel_label();
    },
  },
  RESIZE_PANEL_RIGHT: {
    key: 'mod+alt+right',
    get label() {
      return m.ui_shortcuts_growPanel_label();
    },
  },
  SPLIT_PANEL_HORIZONTAL: {
    key: 'mod+\\',
    get label() {
      return m.ui_shortcuts_splitPanelHorizontal_label();
    },
  },
  SPLIT_PANEL_VERTICAL: {
    key: 'mod+shift+\\',
    get label() {
      return m.ui_shortcuts_splitPanelVertical_label();
    },
  },
  COPY_BROWSER_URL: {
    key: 'mod+shift+c',
    get label() {
      return m.ui_shortcuts_copyBrowserUrl_label();
    },
  },

  // ============================================================================
  // Layout Presets
  // ============================================================================
  LAYOUT_FOCUS: {
    key: 'mod+alt+1',
    get label() {
      return m.ui_shortcuts_layoutFocus_label();
    },
  },
  LAYOUT_SPLIT: {
    key: 'mod+alt+2',
    get label() {
      return m.ui_shortcuts_layoutSplit_label();
    },
  },
  LAYOUT_FULL: {
    key: 'mod+alt+3',
    get label() {
      return m.ui_shortcuts_layoutFull_label();
    },
  },
} as const;

/**
 * Get the display string for a shortcut
 */
export function getShortcutDisplay(shortcutKey: keyof typeof SHORTCUTS): string {
  const shortcut = SHORTCUTS[shortcutKey];
  return formatShortcut(shortcut.key);
}

/**
 * Check if the current platform is Mac
 */
export function isMacPlatform(): boolean {
  return isMac;
}

/**
 * Get the modifier key name for the current platform
 */
export function getModifierKey(): string {
  return isMac ? '⌘' : 'Ctrl';
}

/**
 * Shortcut entry with display information
 */
export interface ShortcutEntry {
  key: string;
  label: string;
  contexts?: ShortcutContext[];
}

/**
 * Categorized shortcuts for the cheat sheet
 */
export const SHORTCUT_CATEGORIES: Record<
  ShortcutCategory,
  { title: string; shortcuts: ShortcutEntry[] }
> = {
  global: {
    get title() {
      return m.ui_shortcuts_globalCategory_title();
    },
    shortcuts: [
      {
        key: 'mod+shift+p',
        get label() {
          return m.ui_shortcuts_commandPalette_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+,',
        get label() {
          return m.ui_shortcuts_settings_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+?',
        get label() {
          return m.ui_shortcuts_keyboardShortcuts_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+k',
        get label() {
          return m.ui_shortcuts_commandPalette_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+o',
        get label() {
          return m.ui_shortcuts_toggleSpaces_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+n',
        get label() {
          return m.ui_shortcuts_newAgent_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+f',
        get label() {
          return m.ui_shortcuts_search_label();
        },
        contexts: ['global'],
      },
      {
        key: 'ctrl+tab',
        get label() {
          return m.ui_shortcuts_nextSpace_label();
        },
        contexts: ['global'],
      },
      {
        key: 'ctrl+shift+tab',
        get label() {
          return m.ui_shortcuts_prevSpace_label();
        },
        contexts: ['global'],
      },
    ],
  },
  navigation: {
    get title() {
      return m.ui_shortcuts_navigationCategory_title();
    },
    shortcuts: [
      {
        key: 'mod+[',
        get label() {
          return m.ui_shortcuts_goBack_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+]',
        get label() {
          return m.ui_shortcuts_goForward_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+1-9',
        get label() {
          return m.ui_shortcuts_goToTab_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+t',
        get label() {
          return m.ui_shortcuts_newTab_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+w',
        get label() {
          return m.ui_shortcuts_closeTab_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+t',
        get label() {
          return m.ui_shortcuts_reopenTab_label();
        },
        contexts: ['global'],
      },
    ],
  },
  chat: {
    get title() {
      return m.ui_shortcuts_chatCategory_title();
    },
    shortcuts: [
      {
        key: 'enter',
        get label() {
          return m.ui_shortcuts_sendMessage_label();
        },
        contexts: ['chat'],
      },
      {
        key: 'mod+enter',
        get label() {
          return m.ui_shortcuts_forceSend_label();
        },
        contexts: ['chat'],
      },
      {
        key: 'shift+enter',
        get label() {
          return m.ui_shortcuts_newLine_label();
        },
        contexts: ['chat'],
      },
      {
        key: 'esc',
        get label() {
          return m.ui_shortcuts_stopGeneration_label();
        },
        contexts: ['chat'],
      },
      {
        key: '/',
        get label() {
          return m.ui_shortcuts_focusInput_label();
        },
        contexts: ['chat'],
      },
      {
        key: '@',
        get label() {
          return m.ui_shortcuts_mentionContext_label();
        },
        contexts: ['chat'],
      },
    ],
  },
  editor: {
    get title() {
      return m.ui_shortcuts_editorCategory_title();
    },
    shortcuts: [
      {
        key: 'mod+g',
        get label() {
          return m.ui_shortcuts_goToLine_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+s',
        get label() {
          return m.ui_shortcuts_save_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+z',
        get label() {
          return m.ui_shortcuts_undo_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+shift+z',
        get label() {
          return m.ui_shortcuts_redo_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+shift+9',
        get label() {
          return m.ui_shortcuts_toggleTaskList_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'alt+z',
        get label() {
          return m.ui_shortcuts_toggleWordWrap_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+c',
        get label() {
          return m.ui_shortcuts_copy_label();
        },
        contexts: ['editor'],
      },
      {
        key: 'mod+a',
        get label() {
          return m.ui_shortcuts_selectAll_label();
        },
        contexts: ['editor'],
      },
    ],
  },
  panel: {
    get title() {
      return m.ui_shortcuts_panelCategory_title();
    },
    shortcuts: [
      {
        key: 'mod+b',
        get label() {
          return m.ui_shortcuts_toggleSidebar_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'mod+\\',
        get label() {
          return m.ui_shortcuts_splitHorizontally_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+\\',
        get label() {
          return m.ui_shortcuts_splitVertically_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+m',
        get label() {
          return m.ui_shortcuts_maximizePanel_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+pagedown',
        get label() {
          return m.ui_shortcuts_nextPanel_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+pageup',
        get label() {
          return m.ui_shortcuts_prevPanel_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+pagedown',
        get label() {
          return m.ui_shortcuts_nextTab_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+pageup',
        get label() {
          return m.ui_shortcuts_prevTab_label();
        },
        contexts: ['global'],
      },
      {
        key: 'mod+shift+c',
        get label() {
          return m.ui_shortcuts_copyBrowserUrl_label();
        },
        contexts: ['panel'],
      },
    ],
  },
  leader: {
    get title() {
      return m.ui_shortcuts_leaderCategory_title();
    },
    shortcuts: [
      {
        key: 'h/j/k/l',
        get label() {
          return m.ui_shortcuts_navigatePanels_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'H/J/K/L',
        get label() {
          return m.ui_shortcuts_resizePanels_label();
        },
        contexts: ['panel'],
      },
      {
        key: '%',
        get label() {
          return m.ui_shortcuts_splitRight_label();
        },
        contexts: ['panel'],
      },
      {
        key: '"',
        get label() {
          return m.ui_shortcuts_splitDown_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'z',
        get label() {
          return m.ui_shortcuts_toggleZoom_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'x',
        get label() {
          return m.ui_shortcuts_closePanel_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'o/p',
        get label() {
          return m.ui_shortcuts_nextPrevPanel_label();
        },
        contexts: ['panel'],
      },
      {
        key: '=',
        get label() {
          return m.ui_shortcuts_equalizeSizes_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'q + 1-9',
        get label() {
          return m.ui_shortcuts_jumpToPanel_label();
        },
        contexts: ['panel'],
      },
      {
        key: 'space',
        get label() {
          return m.ui_shortcuts_cycleLayout_label();
        },
        contexts: ['panel'],
      },
    ],
  },
};

/**
 * Get shortcuts for a specific context
 */
export function getShortcutsForContext(
  context: ShortcutContext,
): Record<ShortcutCategory, { title: string; shortcuts: ShortcutEntry[] }> {
  const filtered: Record<ShortcutCategory, { title: string; shortcuts: ShortcutEntry[] }> =
    {} as any;

  for (const [category, data] of Object.entries(SHORTCUT_CATEGORIES)) {
    const relevantShortcuts = data.shortcuts.filter(
      (s) => !s.contexts || s.contexts.includes(context) || s.contexts.includes('global'),
    );
    if (relevantShortcuts.length > 0) {
      filtered[category as ShortcutCategory] = {
        title: data.title,
        shortcuts: relevantShortcuts,
      };
    }
  }

  return filtered;
}

/**
 * Get all shortcuts organized by category
 */
export function getAllShortcutCategories(): typeof SHORTCUT_CATEGORIES {
  return SHORTCUT_CATEGORIES;
}

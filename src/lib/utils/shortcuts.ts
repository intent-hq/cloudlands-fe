/**
 * Centralized Keyboard Shortcuts Registry
 *
 * Single source of truth for all keyboard shortcuts in the app.
 * Provides consistent formatting for tooltips and documentation.
 * Labels/titles use property getters so they re-resolve on locale change.
 */
import { m } from '$shared/paraglide/messages.js';
import {
  resolveShortcut,
  SHORTCUT_DEFAULTS,
  type ShortcutId,
  type ShortcutOverrides,
} from './shortcut-bindings';

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
  NEW_SPACE_TAB: {
    key: 'mod+n',
    get label() {
      return m.workspace_page_newSpace_title();
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
      return m.workspace_shortcuts_closePanelTab_description();
    },
  },
  CLOSE_WORKSPACE_TAB: {
    key: 'mod+shift+w',
    get label() {
      return m.workspace_shortcuts_closeSpaceTab_description();
    },
  },
  GO_BACK: {
    key: 'mod+←',
    get label() {
      return m.ui_shortcuts_goBack_label();
    },
  },
  GO_FORWARD: {
    key: 'mod+→',
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
  NEXT_SPACE: {
    key: 'ctrl+tab',
    get label() {
      return m.ui_shortcuts_nextSpace_label();
    },
  },
  PREVIOUS_SPACE: {
    key: 'ctrl+shift+tab',
    get label() {
      return m.ui_shortcuts_prevSpace_label();
    },
  },
  MOVE_SPACE_TAB_LEFT: {
    key: 'mod+alt+shift+left',
    get label() {
      return m.ui_shortcuts_moveSpaceTabLeft_label();
    },
  },
  MOVE_SPACE_TAB_RIGHT: {
    key: 'mod+alt+shift+right',
    get label() {
      return m.ui_shortcuts_moveSpaceTabRight_label();
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
    key: 'mod+alt+a',
    get label() {
      return m.ui_shortcuts_newAgent_label();
    },
  },
  NEW_NOTE: {
    key: 'mod+alt+n',
    get label() {
      return m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_note_label(),
      });
    },
  },
  NEW_TERMINAL: {
    key: 'mod+alt+t',
    get label() {
      return m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_terminal_label(),
      });
    },
  },
  NEW_BROWSER: {
    key: 'mod+alt+b',
    get label() {
      return m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_browser_label(),
      });
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
  PREVIOUS_PANE: {
    key: 'mod+[',
    get label() {
      return m.ui_shortcuts_prevTab_label();
    },
  },
  NEXT_PANE: {
    key: 'mod+]',
    get label() {
      return m.ui_shortcuts_nextTab_label();
    },
  },
  FOCUS_PREVIOUS_COLUMN: {
    key: 'mod+shift+[',
    get label() {
      return m.ui_shortcuts_prevPanel_label();
    },
  },
  FOCUS_NEXT_COLUMN: {
    key: 'mod+shift+]',
    get label() {
      return m.ui_shortcuts_nextPanel_label();
    },
  },
  MOVE_PANE_PREVIOUS_COLUMN: {
    key: 'mod+alt+pageup',
    get label() {
      return m.ui_shortcuts_movePanePreviousColumn_label();
    },
  },
  MOVE_PANE_NEXT_COLUMN: {
    key: 'mod+alt+pagedown',
    get label() {
      return m.ui_shortcuts_movePaneNextColumn_label();
    },
  },
  CREATE_COLUMN_RIGHT: {
    key: 'mod+\\',
    get label() {
      return m.ui_shortcuts_splitPanelHorizontal_label();
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

export function getShortcutChord(
  shortcutKey: keyof typeof SHORTCUTS,
  mac = isMac,
): { key: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean } {
  const parts = SHORTCUTS[shortcutKey].key.toLowerCase().split('+');
  const key = parts.at(-1) ?? '';
  return {
    key,
    meta: parts.includes('meta') || parts.includes('cmd') || (mac && parts.includes('mod')),
    ctrl: parts.includes('ctrl') || (!mac && parts.includes('mod')),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
  };
}

/**
 * Check if the current platform is Mac
 */
export function isMacPlatform(): boolean {
  return isMac;
}

/**
 * Shortcut entry with display information
 */
export interface ShortcutEntry {
  key: string;
  label: string;
  contexts?: ShortcutContext[];
}

const SHORTCUT_IDS_BY_CATEGORY: Record<ShortcutCategory, readonly ShortcutId[]> = {
  global: [
    'global.command-palette',
    'global.settings',
    'global.keyboard-shortcuts',
    'global.command-palette-alt',
    'global.toggle-spaces',
    'global.new-space',
    'global.search',
    'global.next-space',
    'global.previous-space',
  ],
  navigation: [
    'navigation.go-to-tab',
    'navigation.new-tab',
    'navigation.close-tab',
    'navigation.close-space-tab',
    'navigation.reopen-tab',
    'navigation.move-space-tab-left',
    'navigation.move-space-tab-right',
    'workspace.new-agent',
    'workspace.new-note',
    'workspace.new-terminal',
    'workspace.new-browser',
  ],
  chat: [
    'chat.send',
    'chat.force-send',
    'chat.new-line',
    'chat.focus-input',
    'chat.mention-context',
  ],
  editor: [
    'editor.go-to-line',
    'editor.save',
    'editor.undo',
    'editor.redo',
    'editor.toggle-task-list',
    'editor.toggle-word-wrap',
    'editor.copy',
    'editor.select-all',
  ],
  panel: [
    'panel.toggle-sidebar',
    'panel.create-column-right',
    'panel.focus-next-column',
    'panel.maximize',
    'panel.focus-previous-column',
    'panel.next-pane',
    'panel.previous-pane',
    'panel.move-pane-next-column',
    'panel.move-pane-previous-column',
    'panel.copy-browser-url',
  ],
  leader: [
    'leader.navigate-panels',
    'leader.resize-panels',
    'leader.split-right',
    'leader.toggle-zoom',
    'leader.close-panel',
    'leader.next-previous-panel',
    'leader.equalize-sizes',
    'leader.jump-to-panel',
    'leader.cycle-layout',
  ],
};

export interface ShortcutDefinition extends ShortcutEntry {
  id: ShortcutId;
  category: ShortcutCategory;
  defaultKey: string;
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
          return m.workspace_page_newSpace_title();
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
        key: SHORTCUTS.CLOSE_TAB.key,
        get label() {
          return SHORTCUTS.CLOSE_TAB.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.CLOSE_WORKSPACE_TAB.key,
        get label() {
          return SHORTCUTS.CLOSE_WORKSPACE_TAB.label;
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
      { ...SHORTCUTS.MOVE_SPACE_TAB_LEFT, contexts: ['global'] },
      { ...SHORTCUTS.MOVE_SPACE_TAB_RIGHT, contexts: ['global'] },
      { ...SHORTCUTS.NEW_AGENT, contexts: ['global'] },
      { ...SHORTCUTS.NEW_NOTE, contexts: ['global'] },
      { ...SHORTCUTS.NEW_TERMINAL, contexts: ['global'] },
      { ...SHORTCUTS.NEW_BROWSER, contexts: ['global'] },
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
        key: SHORTCUTS.CREATE_COLUMN_RIGHT.key,
        get label() {
          return SHORTCUTS.CREATE_COLUMN_RIGHT.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.FOCUS_NEXT_COLUMN.key,
        get label() {
          return SHORTCUTS.FOCUS_NEXT_COLUMN.label;
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
        key: SHORTCUTS.FOCUS_PREVIOUS_COLUMN.key,
        get label() {
          return SHORTCUTS.FOCUS_PREVIOUS_COLUMN.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.NEXT_PANE.key,
        get label() {
          return SHORTCUTS.NEXT_PANE.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.PREVIOUS_PANE.key,
        get label() {
          return SHORTCUTS.PREVIOUS_PANE.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.MOVE_PANE_NEXT_COLUMN.key,
        get label() {
          return SHORTCUTS.MOVE_PANE_NEXT_COLUMN.label;
        },
        contexts: ['global'],
      },
      {
        key: SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.key,
        get label() {
          return SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.label;
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

export const SHORTCUT_REGISTRY: readonly ShortcutDefinition[] = (
  Object.entries(SHORTCUT_CATEGORIES) as [
    ShortcutCategory,
    { title: string; shortcuts: ShortcutEntry[] },
  ][]
).flatMap(([category, data]) =>
  data.shortcuts.map((entry, index) => {
    const id = SHORTCUT_IDS_BY_CATEGORY[category][index];
    if (!id || SHORTCUT_DEFAULTS[id] !== entry.key) {
      throw new Error(`Shortcut registry mismatch for ${category} entry ${index}`);
    }
    return {
      id,
      category,
      defaultKey: SHORTCUT_DEFAULTS[id],
      get key() {
        return entry.key;
      },
      get label() {
        return entry.label;
      },
      contexts: entry.contexts,
    };
  }),
);

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
export function getAllShortcutCategories(
  overrides: ShortcutOverrides = {},
): Record<ShortcutCategory, { title: string; shortcuts: ShortcutEntry[] }> {
  return Object.fromEntries(
    (
      Object.entries(SHORTCUT_CATEGORIES) as [
        ShortcutCategory,
        (typeof SHORTCUT_CATEGORIES)[ShortcutCategory],
      ][]
    ).map(([category, data]) => [
      category,
      {
        title: data.title,
        shortcuts: data.shortcuts.map((shortcut, index) => ({
          ...shortcut,
          key: resolveShortcut(SHORTCUT_IDS_BY_CATEGORY[category][index], overrides),
        })),
      },
    ]),
  ) as Record<ShortcutCategory, { title: string; shortcuts: ShortcutEntry[] }>;
}

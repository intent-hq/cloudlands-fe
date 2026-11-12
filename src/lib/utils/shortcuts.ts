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
export type ShortcutCategory =
  'global' | 'navigation' | 'chat' | 'editor' | 'panel' | 'leader' | 'dock';

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

function defaultShortcut(id: ShortcutId, label: () => string) {
  return {
    key: SHORTCUT_DEFAULTS[id] as string,
    get label() {
      return label();
    },
  };
}

/**
 * Shortcuts that code refers to by name for tooltips and handler descriptions.
 * Keys of configurable shortcuts come from SHORTCUT_DEFAULTS.
 */
export const SHORTCUTS = {
  NEW_TAB: defaultShortcut('navigation.new-tab', () => m.ui_shortcuts_newTab_label()),
  CLOSE_TAB: defaultShortcut('navigation.close-tab', () =>
    m.workspace_shortcuts_closePanelTab_description(),
  ),
  CLOSE_WORKSPACE_TAB: defaultShortcut('navigation.close-space-tab', () =>
    m.workspace_shortcuts_closeSpaceTab_description(),
  ),
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
  MOVE_SPACE_TAB_LEFT: defaultShortcut('navigation.move-space-tab-left', () =>
    m.ui_shortcuts_moveSpaceTabLeft_label(),
  ),
  MOVE_SPACE_TAB_RIGHT: defaultShortcut('navigation.move-space-tab-right', () =>
    m.ui_shortcuts_moveSpaceTabRight_label(),
  ),
  NEW_AGENT: defaultShortcut('workspace.new-agent', () => m.ui_shortcuts_newAgent_label()),
  NEW_NOTE: defaultShortcut('workspace.new-note', () =>
    m.layout_panelEmptyState_newItem_tooltip({ label: m.layout_panelEmptyState_note_label() }),
  ),
  NEW_TERMINAL: defaultShortcut('workspace.new-terminal', () =>
    m.layout_panelEmptyState_newItem_tooltip({
      label: m.layout_panelEmptyState_terminal_label(),
    }),
  ),
  NEW_BROWSER: defaultShortcut('workspace.new-browser', () =>
    m.layout_panelEmptyState_newItem_tooltip({ label: m.layout_panelEmptyState_browser_label() }),
  ),
  SEND: defaultShortcut('chat.send', () => m.ui_shortcuts_sendMessage_label()),
  TOGGLE_TASK_LIST: defaultShortcut('editor.toggle-task-list', () =>
    m.ui_shortcuts_toggleTaskList_label(),
  ),
  CONFIRM: {
    key: 'enter',
    get label() {
      return m.ui_shortcuts_confirm_label();
    },
  },
  TOGGLE_SIDEBAR: defaultShortcut('panel.toggle-sidebar', () =>
    m.ui_shortcuts_toggleSidebar_label(),
  ),
  PREVIOUS_PANE: defaultShortcut('panel.previous-pane', () => m.ui_shortcuts_prevTab_label()),
  NEXT_PANE: defaultShortcut('panel.next-pane', () => m.ui_shortcuts_nextTab_label()),
  FOCUS_PREVIOUS_COLUMN: defaultShortcut('panel.focus-previous-column', () =>
    m.ui_shortcuts_prevPanel_label(),
  ),
  FOCUS_NEXT_COLUMN: defaultShortcut('panel.focus-next-column', () =>
    m.ui_shortcuts_nextPanel_label(),
  ),
  MOVE_PANE_PREVIOUS_COLUMN: defaultShortcut('panel.move-pane-previous-column', () =>
    m.ui_shortcuts_movePanePreviousColumn_label(),
  ),
  MOVE_PANE_NEXT_COLUMN: defaultShortcut('panel.move-pane-next-column', () =>
    m.ui_shortcuts_movePaneNextColumn_label(),
  ),
  CREATE_COLUMN_RIGHT: defaultShortcut('panel.create-column-right', () =>
    m.ui_shortcuts_splitPanelHorizontal_label(),
  ),
} as const;

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
  id: ShortcutId;
  key: string;
  label: string;
  contexts?: ShortcutContext[];
}

function entry(id: ShortcutId, label: () => string, contexts?: ShortcutContext[]): ShortcutEntry {
  return {
    id,
    key: SHORTCUT_DEFAULTS[id],
    get label() {
      return label();
    },
    ...(contexts && { contexts }),
  };
}

export interface ShortcutDefinition extends ShortcutEntry {
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
      entry('global.command-palette', () => m.ui_shortcuts_commandPalette_label(), ['global']),
      entry('global.settings', () => m.ui_shortcuts_settings_label(), ['global']),
      entry('global.keyboard-shortcuts', () => m.ui_shortcuts_keyboardShortcuts_label(), [
        'global',
      ]),
      entry('global.command-palette-alt', () => m.ui_shortcuts_commandPalette_label(), ['global']),
      entry('global.toggle-spaces', () => m.home_navigation_description(), ['global']),
      entry('global.new-space', () => m.workspace_page_newSpace_title(), ['global']),
      entry('global.search', () => m.ui_shortcuts_search_label(), ['global']),
      entry('global.next-space', () => m.ui_shortcuts_nextSpace_label(), ['global']),
      entry('global.previous-space', () => m.ui_shortcuts_prevSpace_label(), ['global']),
      entry('global.next-space-alt', () => m.ui_shortcuts_nextSpace_label(), ['global']),
      entry('global.previous-space-alt', () => m.ui_shortcuts_prevSpace_label(), ['global']),
    ],
  },
  navigation: {
    get title() {
      return m.ui_shortcuts_navigationCategory_title();
    },
    shortcuts: [
      entry('navigation.go-to-tab', () => m.ui_shortcuts_goToTab_label(), ['global']),
      entry('navigation.new-tab', () => SHORTCUTS.NEW_TAB.label, ['global']),
      entry('navigation.close-tab', () => SHORTCUTS.CLOSE_TAB.label, ['global']),
      entry('navigation.close-space-tab', () => SHORTCUTS.CLOSE_WORKSPACE_TAB.label, ['global']),
      entry('navigation.reopen-tab', () => m.ui_shortcuts_reopenTab_label(), ['global']),
      entry('navigation.move-space-tab-left', () => SHORTCUTS.MOVE_SPACE_TAB_LEFT.label, [
        'global',
      ]),
      entry('navigation.move-space-tab-right', () => SHORTCUTS.MOVE_SPACE_TAB_RIGHT.label, [
        'global',
      ]),
      entry('workspace.new-agent', () => SHORTCUTS.NEW_AGENT.label, ['global']),
      entry('workspace.new-note', () => SHORTCUTS.NEW_NOTE.label, ['global']),
      entry('workspace.new-terminal', () => SHORTCUTS.NEW_TERMINAL.label, ['global']),
      entry('workspace.new-browser', () => SHORTCUTS.NEW_BROWSER.label, ['global']),
      entry('workspace.set-aside', () => m.home_setAside_shortcut_label()),
    ],
  },
  chat: {
    get title() {
      return m.ui_shortcuts_chatCategory_title();
    },
    shortcuts: [
      entry('chat.send', () => SHORTCUTS.SEND.label, ['chat']),
      entry('chat.force-send', () => m.ui_shortcuts_forceSend_label(), ['chat']),
      entry('chat.new-line', () => m.ui_shortcuts_newLine_label(), ['chat']),
      entry('chat.focus-input', () => m.ui_shortcuts_focusInput_label(), ['chat']),
      entry('chat.mention-context', () => m.ui_shortcuts_mentionContext_label(), ['chat']),
    ],
  },
  editor: {
    get title() {
      return m.ui_shortcuts_editorCategory_title();
    },
    shortcuts: [
      entry('editor.go-to-line', () => m.ui_shortcuts_goToLine_label(), ['editor']),
      entry('editor.save', () => m.ui_shortcuts_save_label(), ['editor']),
      entry('editor.undo', () => m.ui_shortcuts_undo_label(), ['editor']),
      entry('editor.redo', () => m.ui_shortcuts_redo_label(), ['editor']),
      entry('editor.toggle-task-list', () => SHORTCUTS.TOGGLE_TASK_LIST.label, ['editor']),
      entry('editor.toggle-word-wrap', () => m.ui_shortcuts_toggleWordWrap_label(), ['editor']),
      entry('editor.copy', () => m.ui_shortcuts_copy_label(), ['editor']),
      entry('editor.select-all', () => m.ui_shortcuts_selectAll_label(), ['editor']),
    ],
  },
  panel: {
    get title() {
      return m.ui_shortcuts_panelCategory_title();
    },
    shortcuts: [
      entry('panel.toggle-sidebar', () => SHORTCUTS.TOGGLE_SIDEBAR.label, ['panel']),
      entry('panel.create-column-right', () => SHORTCUTS.CREATE_COLUMN_RIGHT.label, ['global']),
      entry('panel.focus-next-column', () => SHORTCUTS.FOCUS_NEXT_COLUMN.label, ['global']),
      entry('panel.maximize', () => m.ui_shortcuts_maximizePanel_label(), ['global']),
      entry('panel.focus-previous-column', () => SHORTCUTS.FOCUS_PREVIOUS_COLUMN.label, ['global']),
      entry('panel.next-pane', () => SHORTCUTS.NEXT_PANE.label, ['global']),
      entry('panel.previous-pane', () => SHORTCUTS.PREVIOUS_PANE.label, ['global']),
      entry('panel.move-pane-next-column', () => SHORTCUTS.MOVE_PANE_NEXT_COLUMN.label, ['global']),
      entry('panel.move-pane-previous-column', () => SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.label, [
        'global',
      ]),
      entry('panel.copy-browser-url', () => m.ui_shortcuts_copyBrowserUrl_label(), ['panel']),
    ],
  },
  leader: {
    get title() {
      return m.ui_shortcuts_leaderCategory_title();
    },
    shortcuts: [
      entry('leader.navigate-panels', () => m.ui_shortcuts_navigatePanels_label(), ['panel']),
      entry('leader.resize-panels', () => m.ui_shortcuts_resizePanels_label(), ['panel']),
      entry('leader.split-right', () => m.ui_shortcuts_splitRight_label(), ['panel']),
      entry('leader.toggle-zoom', () => m.ui_shortcuts_toggleZoom_label(), ['panel']),
      entry('leader.close-panel', () => m.ui_shortcuts_closePanel_label(), ['panel']),
      entry('leader.next-previous-panel', () => m.ui_shortcuts_nextPrevPanel_label(), ['panel']),
      entry('leader.equalize-sizes', () => m.ui_shortcuts_equalizeSizes_label(), ['panel']),
      entry('leader.jump-to-panel', () => m.ui_shortcuts_jumpToPanel_label(), ['panel']),
      entry('leader.cycle-layout', () => m.ui_shortcuts_cycleLayout_label(), ['panel']),
    ],
  },
  // System-wide: they work with any app in front, not only inside Intent.
  dock: {
    get title() {
      return m.ui_shortcuts_dockCategory_title();
    },
    shortcuts: [
      entry('dock.focus', () => m.ui_shortcuts_dockFocus_label(), ['global']),
      entry('dock.capture', () => m.ui_shortcuts_dockCapture_label(), ['global']),
      entry('dock.record', () => m.ui_shortcuts_dockRecord_label(), ['global']),
    ],
  },
};

export const SHORTCUT_REGISTRY: readonly ShortcutDefinition[] = (
  Object.entries(SHORTCUT_CATEGORIES) as [
    ShortcutCategory,
    { title: string; shortcuts: ShortcutEntry[] },
  ][]
).flatMap(([category, data]) =>
  data.shortcuts.map((entry) => ({
    id: entry.id,
    category,
    defaultKey: entry.key,
    key: entry.key,
    get label() {
      return entry.label;
    },
    contexts: entry.contexts,
  })),
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
        shortcuts: data.shortcuts.map((shortcut) => ({
          ...shortcut,
          key: resolveShortcut(shortcut.id, overrides),
        })),
      },
    ]),
  ) as Record<ShortcutCategory, { title: string; shortcuts: ShortcutEntry[] }>;
}

/**
 * Centralized Keyboard Shortcuts Registry
 *
 * Single source of truth for all keyboard shortcuts in the app.
 * Provides consistent formatting for tooltips and documentation.
 */

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
  COMMAND_PALETTE: { key: 'mod+shift+p', label: 'Command Palette' },
  SETTINGS: { key: 'mod+,', label: 'Settings' },
  NEW_TAB: { key: 'mod+t', label: 'New Tab' },
  REOPEN_TAB: { key: 'mod+shift+t', label: 'Reopen Closed Tab' },
  CLOSE_TAB: { key: 'mod+w', label: 'Close Tab' },
  GO_BACK: { key: 'mod+[ / mod+←', label: 'Go Back' },
  GO_FORWARD: { key: 'mod+] / mod+→', label: 'Go Forward' },
  TAB_1_9: { key: 'mod+1-9', label: 'Go to Tab' },
  SEARCH: { key: 'mod+f', label: 'Search' },

  // ============================================================================
  // Dock / Agent Navigation
  // ============================================================================
  NEW_AGENT: { key: 'mod+n', label: 'New Agent' },

  // ============================================================================
  // Chat / Input
  // ============================================================================
  SEND: { key: 'enter', label: 'Send Message' },
  FORCE_SEND: { key: 'mod+enter', label: 'Send (Interrupt)' },
  NEW_LINE: { key: 'shift+enter', label: 'New Line' },
  STOP: { key: 'esc', label: 'Stop Generation' },
  FOCUS_INPUT: { key: '/', label: 'Focus Input' },

  // ============================================================================
  // Message Actions
  // ============================================================================
  COPY: { key: 'mod+c', label: 'Copy' },
  EDIT: { key: 'e', label: 'Edit' },
  REGENERATE: { key: 'r', label: 'Regenerate' },

  // ============================================================================
  // File / Editor
  // ============================================================================
  GO_TO_LINE: { key: 'mod+g', label: 'Go to Line' },
  SAVE: { key: 'mod+s', label: 'Save' },
  UNDO: { key: 'mod+z', label: 'Undo' },
  REDO: { key: 'mod+shift+z', label: 'Redo' },
  TOGGLE_WORD_WRAP: { key: 'alt+z', label: 'Toggle Word Wrap' },

  // ============================================================================
  // Follow Mode
  // ============================================================================
  TOGGLE_FOLLOW: { key: 'mod+shift+f', label: 'Toggle Follow Mode' },
  NEXT_AGENT_FOLLOW: { key: 'mod+shift+right', label: 'Follow Next Agent' },
  PREV_AGENT_FOLLOW: { key: 'mod+shift+left', label: 'Follow Previous Agent' },
  EXIT_FOLLOW: { key: 'esc', label: 'Exit Follow Mode' },

  // ============================================================================
  // Miscellaneous
  // ============================================================================
  CANCEL: { key: 'esc', label: 'Cancel' },
  CONFIRM: { key: 'enter', label: 'Confirm' },
  SELECT_ALL: { key: 'mod+a', label: 'Select All' },

  // ============================================================================
  // Panel Navigation (VS Code-inspired)
  // ============================================================================
  // Note: Cmd+0 is reserved for native browser zoom reset
  FOCUS_MAIN_CONTENT: { key: 'mod+1', label: 'Focus Main Content' },
  FOCUS_DRAWER: { key: 'mod+2', label: 'Focus Drawer' },
  FOCUS_DOCK: { key: 'mod+3', label: 'Focus Dock' },

  // ============================================================================
  // Panel Visibility
  // ============================================================================
  TOGGLE_SIDEBAR: { key: 'mod+b', label: 'Toggle Sidebar' },
  TOGGLE_DRAWER: { key: 'mod+shift+d', label: 'Toggle Drawer' },

  // ============================================================================
  // Quick Panel Focus (VS Code Activity Bar style)
  // ============================================================================
  FOCUS_EXPLORER: { key: 'mod+shift+e', label: 'Focus Explorer' },
  FOCUS_GIT: { key: 'mod+shift+g', label: 'Focus Git Changes' },
  FOCUS_NOTES: { key: 'mod+shift+n', label: 'Focus Notes' },
  FOCUS_ACTIVITY: { key: 'mod+shift+a', label: 'Focus Activity' },

  // ============================================================================
  // Panel Manipulation
  // ============================================================================
  MAXIMIZE_PANEL: { key: 'mod+shift+m', label: 'Maximize Panel' },
  EQUALIZE_PANELS: { key: 'mod+alt+=', label: 'Equalize Panels' },
  RESIZE_PANEL_LEFT: { key: 'mod+alt+left', label: 'Shrink Panel' },
  RESIZE_PANEL_RIGHT: { key: 'mod+alt+right', label: 'Grow Panel' },
  SPLIT_PANEL_HORIZONTAL: { key: 'mod+\\', label: 'Split Panel Horizontally' },
  SPLIT_PANEL_VERTICAL: { key: 'mod+shift+\\', label: 'Split Panel Vertically' },

  // ============================================================================
  // Layout Presets
  // ============================================================================
  LAYOUT_FOCUS: { key: 'mod+alt+1', label: 'Focus Mode' },
  LAYOUT_SPLIT: { key: 'mod+alt+2', label: 'Split View' },
  LAYOUT_FULL: { key: 'mod+alt+3', label: 'Full Layout' },
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
    title: 'Global',
    shortcuts: [
      { key: 'mod+shift+p', label: 'Command Palette', contexts: ['global'] },
      { key: 'mod+,', label: 'Settings', contexts: ['global'] },
      { key: 'mod+/', label: 'Keyboard Shortcuts', contexts: ['global'] },
      { key: 'mod+k', label: 'Command Palette', contexts: ['global'] },
      { key: 'mod+o', label: 'Toggle Spaces', contexts: ['global'] },
      { key: 'mod+n', label: 'New Agent', contexts: ['global'] },
      { key: 'mod+f', label: 'Search', contexts: ['global'] },
      { key: 'ctrl+tab', label: 'Next Space', contexts: ['global'] },
      { key: 'ctrl+shift+tab', label: 'Previous Space', contexts: ['global'] },
    ],
  },
  navigation: {
    title: 'Navigation',
    shortcuts: [
      { key: 'mod+[', label: 'Go Back', contexts: ['global'] },
      { key: 'mod+]', label: 'Go Forward', contexts: ['global'] },
      { key: 'mod+1-9', label: 'Go to Tab', contexts: ['global'] },
      { key: 'mod+t', label: 'New Tab', contexts: ['global'] },
      { key: 'mod+w', label: 'Close Tab', contexts: ['global'] },
      { key: 'mod+shift+t', label: 'Reopen Closed Tab', contexts: ['global'] },
    ],
  },
  chat: {
    title: 'Chat',
    shortcuts: [
      { key: 'enter', label: 'Send Message', contexts: ['chat'] },
      { key: 'mod+enter', label: 'Send (Interrupt)', contexts: ['chat'] },
      { key: 'shift+enter', label: 'New Line', contexts: ['chat'] },
      { key: 'esc', label: 'Stop Generation', contexts: ['chat'] },
      { key: '/', label: 'Focus Input', contexts: ['chat'] },
      { key: '@', label: 'Mention Context', contexts: ['chat'] },
    ],
  },
  editor: {
    title: 'Editor',
    shortcuts: [
      { key: 'mod+g', label: 'Go to Line', contexts: ['editor'] },
      { key: 'mod+s', label: 'Save', contexts: ['editor'] },
      { key: 'mod+z', label: 'Undo', contexts: ['editor'] },
      { key: 'mod+shift+z', label: 'Redo', contexts: ['editor'] },
      { key: 'alt+z', label: 'Toggle Word Wrap', contexts: ['editor'] },
      { key: 'mod+c', label: 'Copy', contexts: ['editor'] },
      { key: 'mod+a', label: 'Select All', contexts: ['editor'] },
    ],
  },
  panel: {
    title: 'Panels',
    shortcuts: [
      { key: 'mod+b', label: 'Toggle Sidebar', contexts: ['panel'] },
      { key: 'mod+\\', label: 'Split Horizontally', contexts: ['global'] },
      { key: 'mod+shift+\\', label: 'Split Vertically', contexts: ['global'] },
      { key: 'mod+shift+m', label: 'Maximize Panel', contexts: ['global'] },
      { key: 'mod+shift+pagedown', label: 'Next Panel', contexts: ['global'] },
      { key: 'mod+shift+pageup', label: 'Previous Panel', contexts: ['global'] },
      { key: 'mod+pagedown', label: 'Next Tab', contexts: ['global'] },
      { key: 'mod+pageup', label: 'Previous Tab', contexts: ['global'] },
    ],
  },
  leader: {
    title: 'Leader Key (⌘;)',
    shortcuts: [
      { key: 'h/j/k/l', label: 'Navigate Panels', contexts: ['panel'] },
      { key: 'H/J/K/L', label: 'Resize Panels', contexts: ['panel'] },
      { key: '%', label: 'Split Right', contexts: ['panel'] },
      { key: '"', label: 'Split Down', contexts: ['panel'] },
      { key: 'z', label: 'Toggle Zoom', contexts: ['panel'] },
      { key: 'x', label: 'Close Panel', contexts: ['panel'] },
      { key: 'o/p', label: 'Next/Prev Panel', contexts: ['panel'] },
      { key: '=', label: 'Equalize Sizes', contexts: ['panel'] },
      { key: 'q + 1-9', label: 'Jump to Panel', contexts: ['panel'] },
      { key: 'space', label: 'Cycle Layout', contexts: ['panel'] },
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

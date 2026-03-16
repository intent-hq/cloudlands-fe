/**
 * Keyboard shortcuts management for chat interfaces
 */

/**
 * Check if the currently focused element is within an xterm terminal.
 * When a terminal is focused, certain shortcuts (like Cmd+K to clear screen)
 * should be passed through to the terminal rather than intercepted by the app.
 */
export function isFocusInTerminal(target?: HTMLElement | null): boolean {
  const activeElement = target ?? (document.activeElement as HTMLElement | null);

  if (!activeElement) {
    return false;
  }

  // xterm.js creates elements with the 'xterm' class and nested structures
  // Check if the active element or any ancestor has the xterm class
  // Note: In Electron, activeElement might be a WebViewElement or other non-standard
  // element that doesn't have the closest() method, so we check for its existence
  if (
    activeElement.classList?.contains('xterm') ||
    activeElement.classList?.contains('xterm-helper-textarea') ||
    (typeof activeElement.closest === 'function' && activeElement.closest('.xterm'))
  ) {
    return true;
  }

  // Also check if focus is within the terminal panel content area
  // (e.g., right after creating a terminal before xterm gets focus).
  // Use '.terminal-panel' (the content area) rather than '.terminal-overlay'
  // (the full container) so that focus on the tab bar doesn't block
  // app-level keyboard shortcuts like Cmd+J to toggle the terminal.
  if (
    typeof activeElement.closest === 'function' &&
    activeElement.closest('.terminal-panel')
  ) {
    return true;
  }

  return false;
}

/**
 * Check if the currently focused element is an editable element where
 * navigation shortcuts (like Alt+Left/Right) should NOT trigger.
 *
 * This includes:
 * - Standard input and textarea elements
 * - Contenteditable elements (including TipTap editors)
 * - Monaco editor instances
 * - CodeMirror editors
 * - Elements with textbox role
 */
export function isFocusInEditableElement(target?: HTMLElement | null): boolean {
  const activeElement = target ?? (document.activeElement as HTMLElement | null);

  if (!activeElement) {
    return false;
  }

  const tagName = activeElement.tagName?.toUpperCase();

  // Standard form elements
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true;
  }

  // Contenteditable elements (covers TipTap and other rich text editors)
  // Note: In Electron, activeElement might be a WebViewElement or other non-standard
  // element that doesn't have the closest() or getAttribute() methods, so we check for their existence
  const hasClosest = typeof activeElement.closest === 'function';
  const hasGetAttribute = typeof activeElement.getAttribute === 'function';
  if (
    activeElement.isContentEditable ||
    (hasGetAttribute && activeElement.getAttribute('contenteditable') === 'true') ||
    (hasClosest && activeElement.closest('[contenteditable="true"]'))
  ) {
    return true;
  }

  // ARIA textbox role (custom text inputs)
  const role = hasGetAttribute ? activeElement.getAttribute('role') : null;
  if (role === 'textbox') {
    return true;
  }

  // Monaco editor - check for monaco-specific classes
  if (
    activeElement.classList?.contains('monaco-editor') ||
    activeElement.classList?.contains('inputarea') ||
    (hasClosest && activeElement.closest('.monaco-editor'))
  ) {
    return true;
  }

  // CodeMirror editor
  if (
    activeElement.classList?.contains('cm-content') ||
    (hasClosest && activeElement.closest('.cm-editor'))
  ) {
    return true;
  }

  // TipTap/ProseMirror editor
  if (
    activeElement.classList?.contains('ProseMirror') ||
    (hasClosest && activeElement.closest('.ProseMirror'))
  ) {
    return true;
  }

  return false;
}

/**
 * Shortcuts reserved by the operating system that MUST NOT be intercepted.
 * Registering any of these will log a warning in development mode.
 *
 * macOS reserves: Cmd+` (window cycling), Cmd+Tab (app switcher),
 * Cmd+H (hide), Cmd+Q (quit), Cmd+Space (Spotlight).
 * Some (hide/quit) are handled by Electron menu roles and are safe there,
 * but must never be registered in the renderer-side KeyboardShortcutManager.
 */
export const RESERVED_NATIVE_SHORTCUTS: ReadonlyArray<{
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  reason: string;
}> = [
  { key: '`', meta: true, reason: 'macOS window cycling (Cmd+`)' },
  { key: 'tab', meta: true, reason: 'macOS app switcher (Cmd+Tab)' },
  { key: 'h', meta: true, reason: 'macOS hide application (Cmd+H)' },
  { key: 'q', meta: true, reason: 'macOS quit application (Cmd+Q)' },
  { key: ' ', meta: true, reason: 'macOS Spotlight search (Cmd+Space)' },
];

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
  /**
   * If true, this shortcut will be skipped when focus is in an editable element
   * (input, textarea, contenteditable, etc.). This is useful for shortcuts that
   * conflict with standard text editing shortcuts (e.g., Cmd+Up/Down for cursor navigation).
   */
  skipInEditableElements?: boolean;
  /**
   * If true, this shortcut will always fire even when focus is in an input/textarea/contenteditable.
   * Use this for shortcuts like Ctrl+` (toggle terminal) that should work regardless of focus,
   * bypassing the platform-specific Emacs shortcut protection on macOS.
   */
  global?: boolean;
}

export class KeyboardShortcutManager {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private enabled = false;
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.boundHandler = this.handleKeyDown.bind(this);
  }

  /**
   * Register a keyboard shortcut.
   * Warns in development mode if the shortcut conflicts with a reserved native OS shortcut.
   */
  register(shortcut: KeyboardShortcut): void {
    // Dev-mode guard: warn if registering a reserved native shortcut
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      for (const reserved of RESERVED_NATIVE_SHORTCUTS) {
        if (
          shortcut.key.toLowerCase() === reserved.key.toLowerCase() &&
          !!shortcut.meta === !!reserved.meta &&
          !!shortcut.ctrl === !!reserved.ctrl &&
          !!shortcut.shift === !!reserved.shift &&
          !!shortcut.alt === !!reserved.alt
        ) {
          console.warn(
            `[KeyboardShortcutManager] WARNING: Registering shortcut "${this.getShortcutKey(shortcut)}" ` +
              `conflicts with reserved native shortcut: ${reserved.reason}. ` +
              `This will prevent the OS from handling this key combination.`,
          );
        }
      }
    }

    const key = this.getShortcutKey(shortcut);
    this.shortcuts.set(key, shortcut);
  }

  /**
   * Unregister a keyboard shortcut
   */
  unregister(shortcut: KeyboardShortcut): void {
    const key = this.getShortcutKey(shortcut);
    this.shortcuts.delete(key);
  }

  /**
   * Enable keyboard shortcuts
   */
  enable(): void {
    if (!this.enabled && this.boundHandler) {
      // Use capture to intercept before other handlers can stopPropagation
      window.addEventListener('keydown', this.boundHandler, true);
      this.enabled = true;
    }
  }

  /**
   * Disable keyboard shortcuts
   */
  disable(): void {
    if (this.enabled && this.boundHandler) {
      // Must pass the same capture option used in addEventListener
      window.removeEventListener('keydown', this.boundHandler, true);
      this.enabled = false;
    }
  }

  /**
   * Attach to window
   */
  attach(): void {
    this.enable();
  }

  /**
   * Detach from window
   */
  detach(): void {
    this.disable();
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;

    // Don't intercept shortcuts when focus is in a terminal (xterm)
    // Terminals need to receive shortcuts like Cmd+K (clear screen) directly
    if (isFocusInTerminal(target)) {
      return;
    }

    // Don't handle shortcuts when typing in inputs (unless it's a global shortcut)
    const isInput =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true';

    // Build the shortcut key
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');

    // When Alt is pressed, e.key may return the modified character (e.g., "Ω" for Alt+Z on Mac)
    // Use e.code to get the physical key instead (e.g., "KeyZ" -> "z")
    let keyValue = e.key.toLowerCase();
    if (e.altKey && e.code.startsWith('Key')) {
      keyValue = e.code.slice(3).toLowerCase(); // "KeyZ" -> "z"
    } else if (e.altKey && e.code.startsWith('Digit')) {
      keyValue = e.code.slice(5); // "Digit1" -> "1"
    }
    parts.push(keyValue);

    const key = parts.join('+');
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      // Check if this shortcut should be skipped when in editable elements
      // This allows standard text editing shortcuts (like Cmd+Up/Down) to work
      if (shortcut.skipInEditableElements && isFocusInEditableElement(target)) {
        return;
      }

      // Check if we should handle this shortcut in an input
      // On macOS, Ctrl+key are Emacs shortcuts (Ctrl+A/E/K/P/N/etc.) and should NOT
      // be intercepted when in an editable element. Only Meta (Cmd) shortcuts are global on Mac.
      const isMac =
        typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
      const isGlobalShortcut = isMac
        ? shortcut.meta || shortcut.alt // On Mac, only Cmd/Alt shortcuts are global
        : shortcut.ctrl || shortcut.meta || shortcut.alt; // On Win/Linux, Ctrl is also global

      if (!isInput || isGlobalShortcut || shortcut.global) {
        e.preventDefault();
        e.stopPropagation();
        shortcut.action();
      }
    }
  }

  /**
   * Get a unique key for a shortcut
   */
  private getShortcutKey(shortcut: KeyboardShortcut): string {
    const parts: string[] = [];
    if (shortcut.ctrl) parts.push('ctrl');
    if (shortcut.meta) parts.push('meta');
    if (shortcut.shift) parts.push('shift');
    if (shortcut.alt) parts.push('alt');
    parts.push(shortcut.key.toLowerCase());
    return parts.join('+');
  }

  /**
   * Get all registered shortcuts
   */
  getShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Clear all shortcuts
   */
  clear(): void {
    this.shortcuts.clear();
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    this.detach();
    this.clear();
  }
}

/**
 * Common chat keyboard shortcuts
 */
export const CHAT_SHORTCUTS = {
  // Navigation
  SCROLL_TO_BOTTOM: {
    key: 'End',
    description: 'Scroll to bottom',
  },
  SCROLL_TO_TOP: {
    key: 'Home',
    description: 'Scroll to top',
  },
  PREVIOUS_MESSAGE: {
    key: 'ArrowUp',
    alt: true,
    description: 'Navigate to previous message',
  },
  NEXT_MESSAGE: {
    key: 'ArrowDown',
    alt: true,
    description: 'Navigate to next message',
  },

  // Actions
  FOCUS_INPUT: {
    key: '/',
    description: 'Focus chat input',
  },
  SEND_MESSAGE: {
    key: 'Enter',
    ctrl: true,
    description: 'Send message',
  },
  NEW_LINE: {
    key: 'Enter',
    shift: true,
    description: 'Insert new line',
  },
  COPY_LAST_MESSAGE: {
    key: 'c',
    ctrl: true,
    shift: true,
    description: 'Copy last message',
  },
  EDIT_LAST_MESSAGE: {
    key: 'e',
    ctrl: true,
    shift: true,
    description: 'Edit last user message',
  },
  DELETE_LAST_MESSAGE: {
    key: 'd',
    ctrl: true,
    shift: true,
    description: 'Delete last message',
  },
  SEARCH: {
    key: 'f',
    ctrl: true,
    description: 'Search messages',
  },
  TOGGLE_SIDEBAR: {
    key: 'b',
    ctrl: true,
    description: 'Toggle sidebar',
  },

  // Platform-specific
  ...getPlatformShortcuts(),
};

/**
 * Get platform-specific shortcuts
 */
function getPlatformShortcuts() {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  if (isMac) {
    return {
      SEND_MESSAGE_MAC: {
        key: 'Enter',
        meta: true,
        description: 'Send message (Mac)',
      },
      COPY_LAST_MESSAGE_MAC: {
        key: 'c',
        meta: true,
        shift: true,
        description: 'Copy last message (Mac)',
      },
      SEARCH_MAC: {
        key: 'f',
        meta: true,
        description: 'Search messages (Mac)',
      },
    };
  }

  return {};
}

/**
 * Create a keyboard shortcut manager with default chat shortcuts
 */
export function createChatShortcuts(handlers: {
  onScrollToBottom?: () => void;
  onScrollToTop?: () => void;
  onPreviousMessage?: () => void;
  onNextMessage?: () => void;
  onFocusInput?: () => void;
  onSendMessage?: () => void;
  onCopyLastMessage?: () => void;
  onEditLastMessage?: () => void;
  onDeleteLastMessage?: () => void;
  onSearch?: () => void;
  onToggleSidebar?: () => void;
}): KeyboardShortcutManager {
  const manager = new KeyboardShortcutManager();

  // Register shortcuts with handlers
  if (handlers.onScrollToBottom) {
    manager.register({
      ...CHAT_SHORTCUTS.SCROLL_TO_BOTTOM,
      action: handlers.onScrollToBottom,
    });
  }

  if (handlers.onScrollToTop) {
    manager.register({
      ...CHAT_SHORTCUTS.SCROLL_TO_TOP,
      action: handlers.onScrollToTop,
    });
  }

  if (handlers.onPreviousMessage) {
    manager.register({
      ...CHAT_SHORTCUTS.PREVIOUS_MESSAGE,
      action: handlers.onPreviousMessage,
    });
  }

  if (handlers.onNextMessage) {
    manager.register({
      ...CHAT_SHORTCUTS.NEXT_MESSAGE,
      action: handlers.onNextMessage,
    });
  }

  if (handlers.onFocusInput) {
    manager.register({
      ...CHAT_SHORTCUTS.FOCUS_INPUT,
      action: handlers.onFocusInput,
    });
  }

  if (handlers.onSearch) {
    manager.register({
      ...CHAT_SHORTCUTS.SEARCH,
      action: handlers.onSearch,
    });
  }

  return manager;
}

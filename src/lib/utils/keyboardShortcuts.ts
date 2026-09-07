/**
 * Keyboard shortcuts management for chat interfaces
 */
import { matchesShortcut } from './shortcut-bindings';

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
  if (typeof activeElement.closest === 'function' && activeElement.closest('.terminal-panel')) {
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
export function isFocusInEditableElement(target?: Element | null): boolean {
  const activeElement = target ?? document.activeElement;

  if (!activeElement) {
    return false;
  }

  const tagName = activeElement.tagName?.toUpperCase();

  // Standard form elements
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  // Contenteditable elements (covers TipTap and other rich text editors)
  // Note: In Electron, activeElement might be a WebViewElement or other non-standard
  // element that doesn't have the closest() or getAttribute() methods, so we check for their existence
  const hasClosest = typeof activeElement.closest === 'function';
  const hasGetAttribute = typeof activeElement.getAttribute === 'function';
  if (
    (activeElement instanceof HTMLElement && activeElement.isContentEditable) ||
    (hasGetAttribute && activeElement.getAttribute('contenteditable') === 'true') ||
    (hasClosest && activeElement.closest('[contenteditable="true"]'))
  ) {
    return true;
  }

  // ARIA textbox role (custom text inputs)
  const role = hasGetAttribute ? activeElement.getAttribute('role') : null;
  if (role === 'textbox' || (hasClosest && activeElement.closest('[role="textbox"]'))) {
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
const RESERVED_NATIVE_SHORTCUTS: ReadonlyArray<{
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
  /** Resolve a user-configurable binding at event time. */
  binding?: () => string;
  /**
   * If true, this shortcut will be skipped when focus is in an editable element
   * (input, textarea, contenteditable, etc.). This is useful for shortcuts that
   * conflict with standard text editing shortcuts (e.g., Cmd+Up/Down for cursor navigation).
   */
  skipInEditableElements?: boolean;
  /** If true, held-key repeat events are ignored. */
  ignoreRepeat?: boolean;
  /** Checked before preventing the event, so route-scoped shortcuts remain native elsewhere. */
  enabled?: () => boolean;
  /**
   * Fires even when focus is inside an xterm terminal. The terminal adapter handles its own
   * Mod+T/W/J/F/K, so only set this on shortcuts xterm does not consume.
   */
  allowInTerminal?: boolean;
  /**
   * If true, this shortcut will always fire even when focus is in an input/textarea/contenteditable.
   * Use this for shortcuts like Ctrl+` (toggle terminal) that should work regardless of focus,
   * bypassing the platform-specific Emacs shortcut protection on macOS.
   */
  global?: boolean;
}

export class KeyboardShortcutManager {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private dynamicShortcuts: KeyboardShortcut[] = [];
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
    if (shortcut.binding) {
      this.dynamicShortcuts.push(shortcut);
      return;
    }
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
            // i18n-ignore (dev console warning)
            `[KeyboardShortcutManager] WARNING: Registering shortcut "${this.getShortcutKey(shortcut)}" ` +
              // i18n-ignore (dev console warning)
              `conflicts with reserved native shortcut: ${reserved.reason}. ` +
              // i18n-ignore (dev console warning)
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

    if (target.closest?.('[data-shortcut-input], [data-shortcut-entry]')) return;

    const inTerminal = isFocusInTerminal(target);

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
    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    const shortcut =
      [...this.dynamicShortcuts]
        .reverse()
        .find(({ binding }) => binding && matchesKeyboardEvent(e, binding(), isMac)) ??
      this.shortcuts.get(key);

    if (shortcut) {
      if (inTerminal && !shortcut.allowInTerminal) return;
      if (shortcut.ignoreRepeat && e.repeat) return;
      if (shortcut.enabled && !shortcut.enabled()) return;

      // Check if this shortcut should be skipped when in editable elements
      // This allows standard text editing shortcuts (like Cmd+Up/Down) to work
      if (shortcut.skipInEditableElements && isFocusInEditableElement(target)) {
        return;
      }

      // Check if we should handle this shortcut in an input
      // On macOS, Ctrl+key are Emacs shortcuts (Ctrl+A/E/K/P/N/etc.) and should NOT
      // be intercepted when in an editable element. Only Meta (Cmd) shortcuts are global on Mac.
      const isGlobalShortcut = isMac
        ? e.metaKey || e.altKey // On Mac, only Cmd/Alt shortcuts are global
        : e.ctrlKey || e.metaKey || e.altKey; // On Win/Linux, Ctrl is also global

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
    this.dynamicShortcuts = [];
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    this.detach();
    this.clear();
  }
}

function matchesKeyboardEvent(event: KeyboardEvent, binding: string, isMac: boolean): boolean {
  const key =
    event.altKey && event.code.startsWith('Key')
      ? event.code.slice(3)
      : event.altKey && event.code.startsWith('Digit')
        ? event.code.slice(5)
        : event.key;
  return matchesShortcut(
    {
      key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    },
    binding,
    isMac,
  );
}

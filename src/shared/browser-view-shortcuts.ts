/**
 * App shortcuts typed inside a main-owned browser page (Labs).
 *
 * A `<webview>` page gets an injected script that forwards these keys to the
 * app (browser-keyboard-interceptor.ts). A main-owned page has no host
 * element, so main reads them in `before-input-event` instead, stops them
 * reaching the page, and sends them to the renderer that shows the tab
 * (design §2.6). The list matches the injected script.
 */

/** The key fields of Electron's `Input` that the classifier reads. */
export interface BrowserViewKeyInput {
  type: string;
  key: string;
  /** Physical key (`KeyI`); Option on macOS changes `key` but not `code`. */
  code?: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

export type BrowserViewShortcutAction =
  | 'close-tab'
  | 'refresh'
  | 'focus-url'
  | 'copy-url'
  | 'devtools'
  /** A panel or column key the renderer's shortcut manager runs as a keydown. */
  | 'forward';

export interface BrowserViewShortcut {
  action: BrowserViewShortcutAction;
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** The app shortcut a key press in a browser page means, or null for the page's own keys. */
export function classifyBrowserViewShortcut(
  input: BrowserViewKeyInput,
  isMac: boolean,
): BrowserViewShortcut | null {
  if (input.type !== 'keyDown') return null;
  const { key, shift, control, alt, meta } = input;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const letter = (value: string): boolean =>
    lower === value || input.code === `Key${value.toUpperCase()}`;
  const isMod = meta || control;
  const shortcut = (action: BrowserViewShortcutAction): BrowserViewShortcut => ({
    action,
    key,
    shiftKey: shift,
    metaKey: meta,
    ctrlKey: control,
    altKey: alt,
  });

  if (isMod && letter('w')) return shortcut('close-tab');
  if (key === 'F5' || (isMod && letter('r'))) return shortcut('refresh');
  if (isMod && !shift && !alt && letter('l')) return shortcut('focus-url');
  if (isMod && !alt && ['[', ']', '{', '}'].includes(key)) return shortcut('forward');
  // Column focus: Mod+Alt+Left/Right, where Mod is Cmd on macOS and Ctrl elsewhere.
  const isPlatformMod = isMac ? meta && !control : control && !meta;
  if (isPlatformMod && alt && !shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    return shortcut('forward');
  }
  if (isMod && shift && !alt && letter('c')) return shortcut('copy-url');
  if ((meta && alt && letter('i')) || (control && shift && letter('i'))) {
    return shortcut('devtools');
  }
  return null;
}

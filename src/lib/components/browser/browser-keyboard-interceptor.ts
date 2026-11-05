/**
 * Keyboard interceptor injected into browser-panel webviews.
 *
 * A webview runs in a separate process, so its keyboard events never reach the app window. The
 * script captures app shortcuts and logs special messages the host reads from `console-message`.
 */

const PANEL_SHORTCUT_PREFIX = '__INTENT_PANEL_BRACKET__:';

// i18n-ignore: This script is an internal webview protocol, not user-facing text.
export const keyboardInterceptorScript = `
    (function() {
      if (window.__augmentKeyboardInterceptorInstalled) return;
      window.__augmentKeyboardInterceptorInstalled = true;
      function forwardPanelShortcut(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log(
          '${PANEL_SHORTCUT_PREFIX}' +
            [
              e.key,
              e.shiftKey ? '1' : '0',
              e.metaKey ? '1' : '0',
              e.ctrlKey ? '1' : '0',
              e.altKey ? '1' : '0',
            ].join(':')
        );
      }
      document.addEventListener('keydown', function(e) {
        const isMod = e.metaKey || e.ctrlKey;
        // Cmd+W / Ctrl+W - close tab
        if (isMod && (e.key === 'w' || e.key === 'W')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_CLOSE_TAB__');
        }
        // Cmd+R / Ctrl+R / F5 - refresh browser
        if (e.key === 'F5' || (isMod && (e.key === 'r' || e.key === 'R'))) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_REFRESH__');
        }
        // Cmd+L / Ctrl+L - edit the current address
        if (isMod && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_FOCUS_URL__');
        }
        // Forward pane (Mod+[ ]) and workspace-tab (Mod+Shift+[ ]) bracket shortcuts.
        if (isMod && !e.altKey && ['[', ']', '{', '}'].includes(e.key)) {
          forwardPanelShortcut(e);
        }
        // Forward column focus (Mod+Alt+Left/Right). Mod is Cmd on macOS and Ctrl elsewhere,
        // so Ctrl+Opt+Arrow on a Mac stays with the page.
        const isMac = /mac/i.test(navigator.platform);
        const isPlatformMod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
        if (
          isPlatformMod &&
          e.altKey &&
          !e.shiftKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          forwardPanelShortcut(e);
        }
        // Cmd+Shift+C / Ctrl+Shift+C - copy current browser URL
        if (isMod && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_COPY_URL__');
        }
        // Cmd+Option+I / Ctrl+Shift+I - open devtools
        if ((e.metaKey && e.altKey && (e.key === 'i' || e.key === 'I')) ||
            (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I'))) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_DEVTOOLS__');
        }
      }, true);
    })();
  `;

export interface ForwardedPanelShortcut {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Parse a forwarded panel shortcut message; older scripts omit the Alt flag. */
export function parseForwardedPanelShortcut(message: string): ForwardedPanelShortcut | null {
  if (!message.startsWith(PANEL_SHORTCUT_PREFIX)) return null;
  const [key, shiftKey, metaKey, ctrlKey, altKey] = message
    .slice(PANEL_SHORTCUT_PREFIX.length)
    .split(':');
  if (!key) return null;
  return {
    key,
    shiftKey: shiftKey === '1',
    metaKey: metaKey === '1',
    ctrlKey: ctrlKey === '1',
    altKey: altKey === '1',
  };
}

/**
 * Browser back/forward fires on Alt+Left/Right without Cmd/Ctrl; Mod+Alt+Left/Right is column
 * focus and must never navigate any browser panel.
 */
export function getBrowserHistoryDirection(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey'>,
): 'back' | 'forward' | null {
  if (!event.altKey || event.metaKey || event.ctrlKey) return null;
  if (event.key === 'ArrowLeft') return 'back';
  if (event.key === 'ArrowRight') return 'forward';
  return null;
}

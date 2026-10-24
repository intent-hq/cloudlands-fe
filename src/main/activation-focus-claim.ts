/**
 * Short-lived claim on which window an app activation should focus.
 *
 * On macOS a notification click also activates the app, which emits
 * `app.on('activate')`. That handler focuses the main window by default and
 * can run after the notification click handler focused the window that owns
 * the notification's workspace, raising the wrong window (e.g. another
 * host's window). The click handler claims its target here; the activate
 * handler prefers a live claim over the main window.
 */

interface ClaimableWindow {
  isDestroyed(): boolean;
}

export const ACTIVATION_FOCUS_CLAIM_TTL_MS = 2000;

let claim: { window: ClaimableWindow; expiresAt: number } | null = null;

export function claimActivationFocus(
  window: ClaimableWindow,
  now: number = Date.now(),
  ttlMs: number = ACTIVATION_FOCUS_CLAIM_TTL_MS,
): void {
  claim = { window, expiresAt: now + ttlMs };
}

export function getActivationFocusClaim<W extends ClaimableWindow>(
  now: number = Date.now(),
): W | undefined {
  if (!claim) return undefined;
  if (now >= claim.expiresAt || claim.window.isDestroyed()) {
    claim = null;
    return undefined;
  }
  return claim.window as W;
}

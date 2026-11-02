/**
 * Whether this renderer is the chrome-less HUD pop-out window.
 *
 * The HUD window registers the same IPC listeners and services as every
 * renderer; navigation must never replace its /hud route with another view.
 * Kept in its own dependency-free module so `navigateToRoute` and the
 * workspace jump helper (`show-workspace.ts`) share one definition.
 */
export function isHudWindowRenderer(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/hud');
}

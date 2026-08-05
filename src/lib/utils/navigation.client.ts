/**
 * Navigation utilities
 *
 * Thin wrapper around SvelteKit's goto() for use in non-route code.
 * This is a renderer-only module importing $app/navigation (SvelteKit).
 * The main-process build excludes this via tsconfig.main.json patterns.
 */
import { createLogger } from './client-logger';

const logger = createLogger('Navigation');

/**
 * Whether this renderer is the chrome-less HUD pop-out window.
 *
 * The HUD window registers the same IPC listeners and services as every
 * renderer; navigation must never replace its /hud route with another view.
 */
export function isHudWindowRenderer(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/hud');
}

/**
 * Navigate to an arbitrary route.
 *
 * Use this for generic navigation from non-route code (e.g., event handlers, middleware).
 * For workspace-specific navigation (agents, notes, files), prefer the helpers in
 * workspace-navigation.ts which add workspace context.
 *
 * No-ops in the HUD pop-out window so stray toast actions / IPC events can
 * never navigate it away from the /hud route.
 *
 * @param route - The route to navigate to (e.g., '/settings', '/workspace/ws-123')
 * @returns Promise that resolves when navigation completes
 */
export async function navigateToRoute(route: string): Promise<void> {
  if (isHudWindowRenderer()) {
    logger.debug('Ignoring navigation in HUD window', { route });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - $app/navigation is a SvelteKit renderer-only module (not available in main process)
  const { goto } = await import('$app/navigation');
  return goto(route);
}

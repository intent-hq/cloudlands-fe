/**
 * Navigation utilities
 *
 * Thin wrapper around SvelteKit's goto() for use in non-route code.
 * This is a renderer-only module importing $app/navigation (SvelteKit).
 * The main-process build excludes this via tsconfig.main.json patterns.
 */
import { createLogger } from './client-logger';

const logger = createLogger('Navigation');

export const SETTINGS_PREV_PATH_KEY = 'settings-previous-path';

/** Matches Settings itself and its query/hash or nested routes. */
export function isSettingsRoute(route: string): boolean {
  return /^\/settings(?:[/?#]|$)/.test(route);
}

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
export async function navigateToRoute(
  route: string,
  options: { assistantContent?: boolean; assistantAgentId?: string } = {},
): Promise<void> {
  if (isHudWindowRenderer()) {
    logger.debug('Ignoring navigation in HUD window', { route });
    return;
  }
  if (options.assistantContent || route.startsWith('intent://') || /^https?:\/\//.test(route)) {
    const { showAssistantContent } = await import('$features/home/assistant-panels');
    if (
      await showAssistantContent(route, {
        preserveFocus: true,
        background: options.assistantContent === true,
        agentId: options.assistantAgentId,
      })
    ) {
      if (options.assistantContent) return;
      const { openPanel } = await import('$store/renderer/slices/sidebar-nav/sidebar-nav-slice');
      const { store } = await import('$store/renderer/store');
      store.dispatch(openPanel('chief'));
      const { goto } = await import('$app/navigation');
      if (window.location.pathname !== '/') await goto('/');
      return;
    }
  }
  // Every entry point (native menu, in-app links, and toast actions) shares
  // this boundary. Only entering Settings replaces its return destination.
  if (
    isSettingsRoute(route) &&
    typeof window !== 'undefined' &&
    typeof sessionStorage !== 'undefined' &&
    !isSettingsRoute(window.location.pathname)
  ) {
    const currentUrl = new URL(window.location.href);
    sessionStorage.setItem(
      SETTINGS_PREV_PATH_KEY,
      currentUrl.pathname + currentUrl.search + currentUrl.hash,
    );
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - $app/navigation is a SvelteKit renderer-only module (not available in main process)
  const { goto } = await import('$app/navigation');
  return goto(route);
}

// @ts-nocheck - Renderer-only file importing $app/navigation (SvelteKit). Excluded from main-process build.
/**
 * Navigation utilities
 *
 * Thin wrapper around SvelteKit's goto() for use in non-route code.
 * Uses dynamic import to avoid TypeScript resolution errors in the main process build.
 */

/**
 * Navigate to an arbitrary route.
 *
 * Use this for generic navigation from non-route code (e.g., event handlers, middleware).
 * For workspace-specific navigation (agents, notes, files), prefer the helpers in
 * workspace-navigation.ts which add workspace context.
 *
 * @param route - The route to navigate to (e.g., '/settings', '/workspace/ws-123')
 * @returns Promise that resolves when navigation completes
 */
export async function navigateToRoute(route: string): Promise<void> {
  const { goto } = await import('$app/navigation');
  return goto(route);
}

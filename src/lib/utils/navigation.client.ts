/**
 * Navigation utilities
 *
 * Thin wrapper around SvelteKit's goto() for use in non-route code.
 * This is a renderer-only module importing $app/navigation (SvelteKit).
 * The main-process build excludes this via tsconfig.main.json patterns.
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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - $app/navigation is a SvelteKit renderer-only module (not available in main process)
  const { goto } = await import('$app/navigation');
  return goto(route);
}

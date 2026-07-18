/**
 * Navigation utilities
 *
 * Thin wrapper around SvelteKit's goto() for use in non-route code.
 * This module is excluded from the main process build (tsconfig.main.json excludes src/lib/**)
 * while features/ code that needs navigation is included, so we isolate the $app/navigation
 * import here to avoid TypeScript resolution errors in the main process build.
 */

import { goto } from '$app/navigation';

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
  return goto(route);
}

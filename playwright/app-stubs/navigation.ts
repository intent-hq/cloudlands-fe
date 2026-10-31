/**
 * Browser-safe stub for the SvelteKit `$app/navigation` module, used by the
 * Playwright CT build (playwright-ct.config.ts aliases `$app` here). The
 * vitest mocks in src/__mocks__/$app depend on `vi` and cannot run in the
 * CT browser bundle.
 */

/**
 * Lands same-origin routes in the history like SvelteKit's `goto`, without
 * loading a page, so callers that check the landed route (show-workspace.ts)
 * see the navigation complete.
 */
export const goto = async (
  url: string | URL,
  options: { replaceState?: boolean } = {},
): Promise<void> => {
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin) return;
  if (options.replaceState) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
};
export const invalidate = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const afterNavigate = (): void => {};
export const beforeNavigate = (): void => {};
export const onNavigate = (): void => {};
export const preloadData = async (): Promise<void> => {};
export const preloadCode = async (): Promise<void> => {};

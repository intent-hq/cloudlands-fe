/**
 * Browser-safe stub for the SvelteKit `$app/navigation` module, used by the
 * Playwright CT build (playwright-ct.config.ts aliases `$app` here). The
 * vitest mocks in src/__mocks__/$app depend on `vi` and cannot run in the
 * CT browser bundle.
 */

/**
 * Land same-origin routes without loading a page or unmounting the CT component.
 */
export const goto = async (
  url: string | URL,
  options: { replaceState?: boolean; state?: App.PageState } = {},
): Promise<void> => {
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin) return;
  const method = options.replaceState ? 'replaceState' : 'pushState';
  window.history[method](options.state ?? {}, '', target);
};
export const invalidate = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const afterNavigate = (): void => {};
export const beforeNavigate = (): void => {};
export const onNavigate = (): void => {};
export const preloadData = async (): Promise<void> => {};
export const preloadCode = async (): Promise<void> => {};

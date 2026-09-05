/**
 * Browser-safe stub for the SvelteKit `$app/navigation` module, used by the
 * Playwright CT build (playwright-ct.config.ts aliases `$app` here). The
 * vitest mocks in src/__mocks__/$app depend on `vi` and cannot run in the
 * CT browser bundle.
 */

export const goto = async (url: string | URL): Promise<void> => {
  window.history.pushState({}, '', url);
};
export const invalidate = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const afterNavigate = (): void => {};
export const beforeNavigate = (): void => {};
export const onNavigate = (): void => {};
export const preloadData = async (): Promise<void> => {};
export const preloadCode = async (): Promise<void> => {};

import { vi } from 'vitest';

/**
 * Like SvelteKit's `goto`, the window ends up on the route. Code that acts
 * once navigation lands (the workspace jump helper opens the tab only when
 * the window is on the target workspace) observes a real arrival.
 */
export const goto = vi.fn(async (url: string | URL) => {
  if (typeof window !== 'undefined') window.history.pushState({}, '', String(url));
});

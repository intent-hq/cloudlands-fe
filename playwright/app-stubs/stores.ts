/**
 * Browser-safe stub for the SvelteKit `$app/stores` module, used by the
 * Playwright CT build (see ./navigation.ts for rationale).
 */
import { readable } from 'svelte/store';

export const page = readable({
  url: new URL('http://localhost/'),
  params: {},
  route: { id: null },
});
export const navigating = readable(null);
export const updated = readable(false);

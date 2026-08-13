/**
 * Browser-safe stub for the SvelteKit `$app/environment` module, used by the
 * Playwright CT build (see ./navigation.ts for rationale).
 */

export const browser = true;
export const building = false;
export const dev = true;
export const version = 'ct-test';

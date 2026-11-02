/**
 * Counts in-app navigations started through the app's navigation helpers
 * (`navigateToRoute` and the workspace jump helper in `show-workspace.ts`).
 *
 * SvelteKit resolves (does not reject) a `goto` that a later navigation
 * abandoned, so a caller that acts after its navigation resolves compares the
 * epoch from just after it started with the epoch once it resolved: a change
 * means a later navigation took over. Dependency-free so test mocks of
 * `navigation.client` do not hide it.
 */
let epoch = 0;

/** Mark the start of a navigation. */
export function bumpNavigationEpoch(): void {
  epoch += 1;
}

/** The current navigation epoch. */
export function navigationEpoch(): number {
  return epoch;
}

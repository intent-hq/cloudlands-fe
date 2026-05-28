/**
 * Re-export createWorkspaceScopedHelpers for main-process consumption.
 * Main-process slices should import from here instead of $lib/store/utils/.
 */
export { createWorkspaceScopedHelpers } from "$lib/store/utils/workspace-scoped";


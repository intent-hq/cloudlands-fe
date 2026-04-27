/**
 * Workspace Page Composables
 *
 * This module exports composables extracted from +page.svelte
 * to reduce file size and improve maintainability.
 *
 * These composables follow the Svelte 5 pattern of using $state, $derived,
 * and $effect inside functions that return reactive objects.
 */

export { useSidebarState, type UseSidebarStateOptions } from './use-sidebar-state.svelte';
export { useTabManagement, type UseTabManagementOptions } from './use-tab-management.svelte';
export { useWorkspaceLoader, type UseWorkspaceLoaderOptions } from './use-workspace-loader.svelte';
export { usePanelActions, type UsePanelActionsOptions } from './use-panel-actions.svelte';
export { useCloseHandlers, type UseCloseHandlersOptions } from './use-close-handlers.svelte';
export { usePanelShortcuts, type UsePanelShortcutsOptions } from './use-panel-shortcuts.svelte';

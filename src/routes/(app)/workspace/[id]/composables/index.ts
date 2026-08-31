/**
 * Workspace Page Composables
 *
 * This module exports composables extracted from +page.svelte
 * to reduce file size and improve maintainability.
 *
 * These composables follow the Svelte 5 pattern of using $state, $derived,
 * and $effect inside functions that return reactive objects.
 */

export { useTabManagement } from './use-tab-management.svelte';
export { useCloseHandlers } from './use-close-handlers.svelte';
export { usePanelShortcuts } from './use-panel-shortcuts.svelte';

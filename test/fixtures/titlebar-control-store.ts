import { readable } from 'svelte/store';

const value =
  <T>(initial: T) =>
  () =>
    readable(initial);

export const selectPanelItem = value(null);
export const selectActiveCard = value(null);
export const selectOnboardingActive = value(false);
export const selectExpandedItem = value(null);
export const selectIsCardPinned = value(false);
export const selectContextMenuOpen = value(false);

export const store = {
  state: { sidebarNav: { deferredLeave: null } },
  dispatch: () => undefined,
};

const action =
  (type: string) =>
  (...payload: unknown[]) => ({ type, payload });
export const togglePanel = action('sidebarNav/togglePanel');
export const setHoveredItem = action('sidebarNav/setHoveredItem');
export const setExpandedItem = action('sidebarNav/setExpandedItem');
export const setDeferredLeave = action('sidebarNav/setDeferredLeave');
export const clearDeferredLeave = action('sidebarNav/clearDeferredLeave');
export const setShowCreateModal = action('sidebarNav/setShowCreateModal');

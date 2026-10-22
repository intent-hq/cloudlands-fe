import { getContext } from 'svelte';

export const SIDEBAR_FLYOUT_CONTEXT = Symbol('sidebar-flyout');

export interface SidebarFlyoutContext {
  readonly collapsed: boolean;
  readonly open: boolean;
  readonly tabId: string | undefined;
  preview: (tabId: string, anchor: HTMLElement, fromFocus?: boolean) => void;
}

export function getSidebarFlyout(): SidebarFlyoutContext | undefined {
  return getContext<SidebarFlyoutContext | undefined>(SIDEBAR_FLYOUT_CONTEXT);
}

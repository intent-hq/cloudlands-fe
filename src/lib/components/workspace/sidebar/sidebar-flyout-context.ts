import { getContext } from 'svelte';

export const SIDEBAR_FLYOUT_CONTEXT = Symbol('sidebar-flyout');

export interface SidebarFlyoutContext {
  readonly collapsed: boolean;
  readonly open: boolean;
  readonly tabId: string | undefined;
  readonly maxHeight: number;
  preview: (tabId: string, anchor: HTMLElement, fromFocus?: boolean) => void;
  resize: (height: number) => void;
}

export function getSidebarFlyout(): SidebarFlyoutContext | undefined {
  return getContext<SidebarFlyoutContext | undefined>(SIDEBAR_FLYOUT_CONTEXT);
}

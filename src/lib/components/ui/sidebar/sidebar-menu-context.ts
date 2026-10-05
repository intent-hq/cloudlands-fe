import type { ProximityHover } from '$lib/interaction';
import { getContext, setContext } from 'svelte';

const SIDEBAR_MENU_CONTEXT = Symbol('sidebar-menu');
const SIDEBAR_MENU_ROW_CONTEXT = Symbol('sidebar-menu-row');
const SIDEBAR_MENU_LEVEL_CONTEXT = Symbol('sidebar-menu-level');
const SIDEBAR_MENU_ACTIONS_CONTEXT = Symbol('sidebar-menu-actions');

export type SidebarMenuLevel = string;

export interface SidebarMenuContext {
  readonly hover: ProximityHover | null;
  readonly activeIndexes: ReadonlyMap<SidebarMenuLevel, number>;
  readonly focusIndex: number | null;
  readonly levels: readonly SidebarMenuLevel[];
  claimIndex(level: SidebarMenuLevel): number;
  registerElement(index: number, element: HTMLElement | null): void;
  setActive(index: number, level: SidebarMenuLevel, active: boolean): void;
  setFocus(index: number | null): void;
  refresh(): void;
}

export interface SidebarMenuRowContext {
  readonly index: number;
  readonly level: SidebarMenuLevel;
  readonly menu: SidebarMenuContext | undefined;
  readonly isSubRow: boolean;
  readonly actionCount: number;
  readonly actionsShowOnHover: boolean;
  readonly hasBadge: boolean;
  registerAction(showOnHover: boolean): () => void;
  setHasBadge(hasBadge: boolean): void;
}

export interface SidebarMenuActionsContext {
  readonly clustered: boolean;
  readonly showOnHover: boolean;
}

export function setSidebarMenuContext(context: SidebarMenuContext): void {
  setContext(SIDEBAR_MENU_CONTEXT, context);
}

export function getSidebarMenuContext(): SidebarMenuContext | undefined {
  return getContext<SidebarMenuContext>(SIDEBAR_MENU_CONTEXT);
}

export function setSidebarMenuLevelContext(level: SidebarMenuLevel): void {
  setContext(SIDEBAR_MENU_LEVEL_CONTEXT, level);
}

export function getSidebarMenuLevelContext(): SidebarMenuLevel {
  return getContext<SidebarMenuLevel>(SIDEBAR_MENU_LEVEL_CONTEXT) ?? 'root';
}

export function setSidebarMenuRowContext(context: SidebarMenuRowContext): void {
  setContext(SIDEBAR_MENU_ROW_CONTEXT, context);
}

export function getSidebarMenuRowContext(): SidebarMenuRowContext | undefined {
  return getContext<SidebarMenuRowContext>(SIDEBAR_MENU_ROW_CONTEXT);
}

export function setSidebarMenuActionsContext(context: SidebarMenuActionsContext): void {
  setContext(SIDEBAR_MENU_ACTIONS_CONTEXT, context);
}

export function getSidebarMenuActionsContext(): SidebarMenuActionsContext | undefined {
  return getContext<SidebarMenuActionsContext>(SIDEBAR_MENU_ACTIONS_CONTEXT);
}

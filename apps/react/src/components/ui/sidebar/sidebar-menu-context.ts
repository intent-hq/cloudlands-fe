import { createContext } from 'react';
import type { ProximityHover } from '@/lib/interaction';

export interface SidebarMenuContextValue {
  hover: ProximityHover | null;
  activeIndexes: ReadonlyMap<string, number>;
  focusIndex: number | null;
  preferredIndex: number | null;
  levels: ReadonlyMap<number, string>;
  claimIndex(level: string): number;
  registerElement(index: number, element: HTMLElement | null, level?: string): void;
  setActive(index: number, level: string, active: boolean): void;
  setFocus(index: number | null): void;
  refresh(): void;
}
export const SidebarMenuContext = createContext<SidebarMenuContextValue | null>(null);
export const SidebarMenuLevelContext = createContext('root');
export const SidebarMenuVisibleContext = createContext(true);
export interface SidebarMenuRowContextValue {
  index: number;
  level: string;
  isSubRow: boolean;
  actionCount: number;
  actionsShowOnHover: boolean;
  hasBadge: boolean;
  registerAction(showOnHover: boolean): () => void;
  setHasBadge(value: boolean): void;
}
export const SidebarMenuRowContext = createContext<SidebarMenuRowContextValue | null>(null);
export const SidebarMenuActionsContext = createContext<{ showOnHover: boolean } | null>(null);

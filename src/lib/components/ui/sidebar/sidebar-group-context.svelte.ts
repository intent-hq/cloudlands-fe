import { getContext, setContext } from 'svelte';

const SIDEBAR_GROUP_CONTEXT = Symbol('sidebar-group');
const SIDEBAR_GROUP_ACTIONS_CONTEXT = Symbol('sidebar-group-actions');

export interface SidebarGroupContext {
  readonly collapsible: boolean;
  readonly open: boolean;
  readonly actionCount: number;
  toggle(): void;
  registerAction(): () => void;
}

export function setSidebarGroupContext(context: SidebarGroupContext): void {
  setContext(SIDEBAR_GROUP_CONTEXT, context);
}

export function getSidebarGroupContext(): SidebarGroupContext | undefined {
  return getContext<SidebarGroupContext>(SIDEBAR_GROUP_CONTEXT);
}

export function setSidebarGroupActionsContext(clustered: boolean): void {
  setContext(SIDEBAR_GROUP_ACTIONS_CONTEXT, clustered);
}

export function getSidebarGroupActionsContext(): boolean {
  return getContext<boolean>(SIDEBAR_GROUP_ACTIONS_CONTEXT) ?? false;
}

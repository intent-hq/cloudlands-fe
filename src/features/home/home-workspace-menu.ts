import { tick } from 'svelte';
import {
  getSidebarContextPosition,
  type SidebarContextPosition,
} from '$lib/components/ui/sidebar-context-menu/types';

export function getHomeWorkspaceContextPosition(
  event: MouseEvent | KeyboardEvent,
): SidebarContextPosition | null {
  const position = getSidebarContextPosition(event);
  if (!position) return null;
  return {
    ...position,
    returnFocus:
      position.returnFocus?.closest<HTMLElement>('[role="option"], button') ?? position.returnFocus,
  };
}

export function restoreHomeWorkspaceFocus(getRoot: () => HTMLElement | null, workspaceId: string) {
  void tick().then(() => {
    requestAnimationFrame(() =>
      getRoot()
        ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspaceId)}"]`)
        ?.closest<HTMLElement>('[role="option"], button')
        ?.focus(),
    );
  });
}

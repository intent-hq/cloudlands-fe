/**
 * Workspace switcher keyboard controller (Ctrl+Tab spaces switcher).
 *
 * Re-homes the deleted workspace-switcher saga's keyboard handling as a plain
 * window-level listener pair (post-saga shortcut owner, like
 * `src/features/layout/panel-keyboard-shortcuts.svelte.ts`). Mounted once from
 * `src/routes/+layout.svelte` so the shortcut works app-wide:
 * - Ctrl+Tab: open the switcher (previous MRU workspace pre-selected) or cycle
 *   forward; Ctrl+Shift+Tab cycles backward.
 * - While open: Escape closes; ArrowDown/j and ArrowUp/k cycle; Home/End jump
 *   to first/last; Enter confirms.
 * - Releasing Control (or Meta) while open confirms and navigates.
 */

import { goto } from '$app/navigation';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
  selectActiveWorkspaceId,
  selectWorkspaceItems,
  selectWorkspacesSortedByRecency,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { openWorkspaceRequested } from '$store/renderer/slices/workspace/workspace-slice';
import {
  selectSelectedWorkspaceId,
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from '$store/renderer/slices/workspace-switcher/workspace-switcher-selectors';
import {
  closeSwitcher,
  confirmSelection,
  cycleNext,
  cyclePrevious,
  openSwitcher,
} from '$store/renderer/slices/workspace-switcher/workspace-switcher-slice';
import { store as appStore } from '$store/renderer/store';

/** Order switcher entries: current workspace first, then MRU others. */
export function buildSwitcherWorkspaceIds(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): string[] {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId);

  if (otherWorkspaces.length === 0) {
    return [];
  }

  const orderedWorkspaces = activeWorkspace
    ? [activeWorkspace, ...otherWorkspaces]
    : otherWorkspaces;

  return orderedWorkspaces.map((workspace) => workspace.id);
}

/** Open the switcher over active (non-archived) workspaces sorted by recency. */
export function openWorkspaceSwitcher(): void {
  const state = appStore.state;
  const activeWorkspaceId = selectActiveWorkspaceId.select(state);
  const activeWorkspaces = selectWorkspaceItems
    .select(state)
    .filter((workspace) => workspace.status !== WorkspaceStatusEnum.Archived);
  const workspacesSortedByRecency = selectWorkspacesSortedByRecency.select(state, activeWorkspaces);
  const workspaceIds = buildSwitcherWorkspaceIds(workspacesSortedByRecency, activeWorkspaceId);

  if (workspaceIds.length === 0) {
    return;
  }

  appStore.dispatch(openSwitcher(workspaceIds, activeWorkspaceId));
}

/** Confirm the selection; navigate only when it differs from the active workspace. */
export function confirmWorkspaceSwitcherSelection(): void {
  const state = appStore.state;
  const workspaceIds = selectSwitcherWorkspaceIds.select(state);
  if (workspaceIds.length === 0) {
    return;
  }

  const selectedWorkspaceId = selectSelectedWorkspaceId.select(state);
  const activeWorkspaceId = selectActiveWorkspaceId.select(state);
  appStore.dispatch(confirmSelection());

  if (selectedWorkspaceId && selectedWorkspaceId !== activeWorkspaceId) {
    appStore.dispatch(openWorkspaceRequested(selectedWorkspaceId));
    void goto(`/workspace/${selectedWorkspaceId}`);
  }
}

export function handleSwitcherKeydown(event: KeyboardEvent): void {
  const state = appStore.state;
  const switcher = selectSwitcherState.select(state);
  const workspaceIds = selectSwitcherWorkspaceIds.select(state);
  const workspaceCount = workspaceIds.length;

  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();

    if (workspaceCount === 0) {
      openWorkspaceSwitcher();
    } else if (event.shiftKey) {
      appStore.dispatch(cyclePrevious(workspaceCount));
    } else {
      appStore.dispatch(cycleNext(workspaceCount));
    }
    return;
  }

  if (workspaceCount === 0) {
    return;
  }

  switch (event.key) {
    case 'Escape': {
      event.preventDefault();
      appStore.dispatch(closeSwitcher());
      return;
    }
    case 'ArrowDown':
    case 'j': {
      event.preventDefault();
      appStore.dispatch(cycleNext(workspaceCount));
      return;
    }
    case 'ArrowUp':
    case 'k': {
      event.preventDefault();
      appStore.dispatch(cyclePrevious(workspaceCount));
      return;
    }
    case 'Enter': {
      event.preventDefault();
      confirmWorkspaceSwitcherSelection();
      return;
    }
    case 'Home': {
      const stepsToStart = Math.max(0, switcher.selectedIndex);
      if (stepsToStart === 0) {
        return;
      }

      event.preventDefault();
      for (let step = 0; step < stepsToStart; step += 1) {
        appStore.dispatch(cyclePrevious(workspaceCount));
      }
      return;
    }
    case 'End': {
      const stepsToEnd = Math.max(0, workspaceCount - 1 - switcher.selectedIndex);
      if (stepsToEnd === 0) {
        return;
      }

      event.preventDefault();
      for (let step = 0; step < stepsToEnd; step += 1) {
        appStore.dispatch(cycleNext(workspaceCount));
      }
      return;
    }
  }
}

/** Releasing the held modifier (Control or Meta) confirms the selection. */
export function handleSwitcherKeyup(event: KeyboardEvent): void {
  if (event.key !== 'Meta' && event.key !== 'Control') {
    return;
  }

  const workspaceIds = selectSwitcherWorkspaceIds.select(appStore.state);
  if (workspaceIds.length === 0) {
    return;
  }

  event.preventDefault();
  confirmWorkspaceSwitcherSelection();
}

/**
 * Attach the window-level keydown/keyup listeners. Returns a cleanup function
 * that removes them; SSR-safe (no-op when `window` is unavailable).
 */
export function attachWorkspaceSwitcherKeyboard(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener('keydown', handleSwitcherKeydown);
  window.addEventListener('keyup', handleSwitcherKeyup);

  return () => {
    window.removeEventListener('keydown', handleSwitcherKeydown);
    window.removeEventListener('keyup', handleSwitcherKeyup);
  };
}

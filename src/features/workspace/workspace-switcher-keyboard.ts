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
import { get, type Readable } from 'svelte/store';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
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
export function openWorkspaceSwitcher(activeWorkspaceId: string | null): void {
  const state = appStore.state;
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
export function confirmWorkspaceSwitcherSelection(activeWorkspaceId: string | null): void {
  const state = appStore.state;
  const workspaceIds = selectSwitcherWorkspaceIds.select(state, activeWorkspaceId);
  if (workspaceIds.length === 0) {
    return;
  }

  const selectedWorkspaceId = selectSelectedWorkspaceId.select(state, activeWorkspaceId);
  appStore.dispatch(confirmSelection());

  if (selectedWorkspaceId && selectedWorkspaceId !== activeWorkspaceId) {
    appStore.dispatch(openWorkspaceRequested(selectedWorkspaceId));
    void goto(`/workspace/${selectedWorkspaceId}`);
  }
}

export function handleSwitcherKeydown(
  event: KeyboardEvent,
  activeWorkspaceId: string | null,
): void {
  const state = appStore.state;
  const switcher = selectSwitcherState.select(state);
  const workspaceIds = selectSwitcherWorkspaceIds.select(state, activeWorkspaceId);
  const workspaceCount = workspaceIds.length;

  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();

    if (workspaceCount === 0) {
      openWorkspaceSwitcher(activeWorkspaceId);
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
      confirmWorkspaceSwitcherSelection(activeWorkspaceId);
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
export function handleSwitcherKeyup(event: KeyboardEvent, activeWorkspaceId: string | null): void {
  if (event.key !== 'Meta' && event.key !== 'Control') {
    return;
  }

  const workspaceIds = selectSwitcherWorkspaceIds.select(appStore.state, activeWorkspaceId);
  if (workspaceIds.length === 0) {
    return;
  }

  event.preventDefault();
  confirmWorkspaceSwitcherSelection(activeWorkspaceId);
}

/**
 * Attach the window-level keydown/keyup listeners. Returns a cleanup function
 * that removes them; SSR-safe (no-op when `window` is unavailable).
 */
export function attachWorkspaceSwitcherKeyboard(
  activeWorkspaceId: Readable<string | null>,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleKeydown = (event: KeyboardEvent) =>
    handleSwitcherKeydown(event, get(activeWorkspaceId));
  const handleKeyup = (event: KeyboardEvent) => handleSwitcherKeyup(event, get(activeWorkspaceId));
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('keyup', handleKeyup);

  return () => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('keyup', handleKeyup);
  };
}

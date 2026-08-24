import type { StoreState } from '$store/renderer/types';
import {
  closeWorkspaceTab,
  reopenLastClosedWorkspaceTab,
  switchToWorkspaceTabByIndex,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectCurrentWorkspaceTabId,
  selectLastClosedWorkspaceTab,
  selectWorkspaceTabOrder,
  selectWorkspaceViewMode,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import {
  closeFocusedPanelTab,
  openBlankWorkingPanel,
  reopenClosedPanelColumn,
  reopenClosedTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  selectPanelColumnCount,
  selectFocusedPanel,
  selectFocusedPanelId,
  selectLastClosedPanelColumn,
  selectRecentlyClosed,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { toggleSidebar } from '$store/renderer/slices/ui-layout/ui-layout-slice';
import { resolveEmptyWindowDestination } from './empty-window-destination';
import type { KeyboardShortcut } from '$lib/utils/keyboardShortcuts';
import { m } from '$shared/paraglide/messages.js';
import { SHORTCUTS, getShortcutChord } from '$lib/utils/shortcuts';
import { isWorkspaceViewModeRoute } from '$features/workspace/workspace-view-mode-action';
import { getPanelKeyboardShortcuts } from '$features/layout/panel-keyboard-shortcuts.svelte';

export type WorkspaceTabDirection = 'next' | 'previous';

export function findAdjacentWorkspaceColumnId(
  stacks: string[][],
  currentWorkspaceId: string,
  direction: WorkspaceTabDirection,
): string | null {
  const navigableStacks = stacks
    .map((stack) => stack.filter((workspaceId) => workspaceId !== 'new'))
    .filter((stack) => stack.length > 0);
  if (navigableStacks.length < 2) return null;
  const currentStackIndex = navigableStacks.findIndex((stack) =>
    stack.includes(currentWorkspaceId),
  );
  if (currentStackIndex < 0) return null;

  const currentRowIndex = navigableStacks[currentStackIndex].indexOf(currentWorkspaceId);
  const offset = direction === 'next' ? 1 : -1;
  const targetStackIndex =
    (currentStackIndex + offset + navigableStacks.length) % navigableStacks.length;
  const targetStack = navigableStacks[targetStackIndex];
  return targetStack?.[Math.min(currentRowIndex, targetStack.length - 1)] ?? null;
}

interface WorkspaceTabNavigationStore {
  readonly state: StoreState;
  dispatch(
    action:
      | ReturnType<typeof switchToNextWorkspaceTab>
      | ReturnType<typeof switchToPreviousWorkspaceTab>
      | ReturnType<typeof switchToWorkspaceTabByIndex>
      | ReturnType<typeof closeWorkspaceTab>
      | ReturnType<typeof reopenLastClosedWorkspaceTab>
      | ReturnType<typeof closeFocusedPanelTab>
      | ReturnType<typeof openBlankWorkingPanel>
      | ReturnType<typeof reopenClosedPanelColumn>
      | ReturnType<typeof reopenClosedTab>
      | ReturnType<typeof toggleSidebar>,
  ): unknown;
}

type RegisterShortcut = (shortcut: KeyboardShortcut) => void;

interface RegisterWorkspaceTabShortcutsOptions {
  isMac: boolean;
  register: RegisterShortcut;
  store: WorkspaceTabNavigationStore;
  getCurrentPath: () => string;
  navigate: (path: string) => unknown;
  openNewWorkspace: () => void;
  toggleWorkspaceViewMode: () => void;
}

function navigateToSelectedWorkspace(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): string | null {
  const workspaceId = selectCurrentWorkspaceTabId.select(store.state);
  const nextPath = workspaceId
    ? `/workspace/${workspaceId}`
    : resolveEmptyWindowDestination(selectWorkspaceItems.select(store.state));
  if (currentPath !== nextPath) navigate(nextPath);
  return workspaceId;
}

function closeWorkspaceTabById(
  store: WorkspaceTabNavigationStore,
  workspaceId: string,
  currentPath: string,
  navigate: (path: string) => unknown,
): string {
  store.dispatch(closeWorkspaceTab(workspaceId));
  navigateToSelectedWorkspace(store, currentPath, navigate);
  return workspaceId;
}

function resolveWorkspaceTabToClose(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
): string | null {
  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match?.[1];
  if (workspaceId) return workspaceId === 'new' ? null : workspaceId;

  const isColumnsRoot = currentPath === '/' || currentPath === '/workspace';
  return isColumnsRoot && selectWorkspaceViewMode.select(store.state) === 'columns'
    ? selectCurrentWorkspaceTabId.select(store.state)
    : null;
}

export function cycleWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  direction: WorkspaceTabDirection,
  currentPath: string,
  navigate: (path: string) => unknown,
): string | null {
  store.dispatch(
    direction === 'next' ? switchToNextWorkspaceTab() : switchToPreviousWorkspaceTab(),
  );
  const workspaceId = selectCurrentWorkspaceTabId.select(store.state);
  if (!workspaceId) return null;

  const nextPath = `/workspace/${workspaceId}`;
  if (currentPath !== nextPath) navigate(nextPath);
  return workspaceId;
}

export function closeActiveWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): string | null {
  const workspaceId = resolveWorkspaceTabToClose(store, currentPath);
  if (!workspaceId) return null;

  return closeWorkspaceTabById(store, workspaceId, currentPath, navigate);
}

/** Close focused content, or remove its already-empty structural column. */
export function closeActivePanelTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  availableCanvasWidth?: number,
): string | null {
  const workspaceId = resolveWorkspaceTabToClose(store, currentPath);
  if (!workspaceId) return null;

  const panel = selectFocusedPanel.select(store.state, workspaceId);
  if (!panel) return null;

  const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId);
  const isEmpty = panel.tabs.length === 0 && panel.activeTabId === null;
  const canRemoveEmptyColumn =
    isEmpty && selectPanelColumnCount.select(store.state, workspaceId) > 1;
  if ((!activeTab || activeTab.closable === false) && !canRemoveEmptyColumn) return null;

  const measuredWidth =
    availableCanvasWidth ??
    getPanelKeyboardShortcuts(workspaceId)?.availableCanvasWidth ??
    undefined;
  store.dispatch(closeFocusedPanelTab(workspaceId, undefined, measuredWidth));
  return activeTab?.id ?? panel.id;
}

export function reopenWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): string | null {
  store.dispatch(reopenLastClosedWorkspaceTab());
  return navigateToSelectedWorkspace(store, currentPath, navigate);
}

/**
 * Contextual Cmd+Shift+T: reopen the newest panel column, panel tab, or
 * workspace tab by comparing close timestamps across both slices.
 */
export function reopenPanelOrWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): 'column' | 'tab' | 'workspace' | null {
  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match && match[1] !== 'new' ? match[1] : null;

  const lastClosedWorkspace = selectLastClosedWorkspaceTab.select(store.state);
  const lastClosedPanelTab = workspaceId
    ? (selectRecentlyClosed.select(store.state, workspaceId)[0] ?? null)
    : null;
  const lastClosedPanelColumn = workspaceId
    ? selectLastClosedPanelColumn.select(store.state, workspaceId)
    : null;
  const lastPanelClose =
    lastClosedPanelColumn &&
    (!lastClosedPanelTab || lastClosedPanelColumn.closedAt >= lastClosedPanelTab.closedAt)
      ? { kind: 'column' as const, closedAt: lastClosedPanelColumn.closedAt }
      : lastClosedPanelTab
        ? { kind: 'tab' as const, closedAt: lastClosedPanelTab.closedAt }
        : null;

  if (
    workspaceId &&
    lastPanelClose &&
    (!lastClosedWorkspace || lastPanelClose.closedAt >= lastClosedWorkspace.closedAt)
  ) {
    if (lastPanelClose.kind === 'column') {
      store.dispatch(reopenClosedPanelColumn(workspaceId));
      return 'column';
    }
    store.dispatch(reopenClosedTab(workspaceId));
    return lastPanelClose.kind;
  }

  if (lastClosedWorkspace) {
    reopenWorkspaceTab(store, currentPath, navigate);
    return 'workspace';
  }

  return null;
}

/** Cmd+T: insert a pristine blank column immediately right of the focused column. */
export function openNewPanel(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
): string | null {
  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match && match[1] !== 'new' ? match[1] : null;
  if (!workspaceId) return null;

  const action = openBlankWorkingPanel(workspaceId);
  store.dispatch(action);
  return selectFocusedPanelId.select(store.state, workspaceId);
}

export function selectWorkspaceTabByPosition(
  store: WorkspaceTabNavigationStore,
  position: number | 'last',
  currentPath: string,
  navigate: (path: string) => unknown,
): string | null {
  const tabOrder = selectWorkspaceTabOrder.select(store.state);
  const index = position === 'last' ? tabOrder.length - 1 : position;
  if (index < 0 || index >= tabOrder.length) return null;

  store.dispatch(switchToWorkspaceTabByIndex(index));
  return navigateToSelectedWorkspace(store, currentPath, navigate);
}

export function registerWorkspaceTabShortcuts({
  isMac,
  register,
  store,
  getCurrentPath,
  navigate,
  openNewWorkspace,
  toggleWorkspaceViewMode,
}: RegisterWorkspaceTabShortcutsOptions): void {
  const mod = isMac ? { meta: true } : { ctrl: true };
  const sidebarChord = getShortcutChord('TOGGLE_SIDEBAR', isMac);
  const workspaceViewModeChord = getShortcutChord('WORKSPACE_VIEW_MODE', isMac);
  const withRoute = (action: (currentPath: string) => unknown) => () => action(getCurrentPath());

  register({
    ...mod,
    key: 'n',
    global: true,
    description: m.workspace_shortcuts_newSpace_description(),
    action: openNewWorkspace,
  });
  register({
    ...sidebarChord,
    global: true,
    description: SHORTCUTS.TOGGLE_SIDEBAR.label,
    action: () => store.dispatch(toggleSidebar()),
  });
  register({
    ...workspaceViewModeChord,
    description: SHORTCUTS.WORKSPACE_VIEW_MODE.label,
    ignoreRepeat: true,
    enabled: () => isWorkspaceViewModeRoute(getCurrentPath()),
    action: toggleWorkspaceViewMode,
  });
  register({
    ...mod,
    key: 't',
    global: true,
    description: m.workspace_shortcuts_newPanel_description(),
    action: withRoute((path) => openNewPanel(store, path)),
  });
  register({
    ...mod,
    key: 'w',
    global: true,
    description: m.workspace_shortcuts_closePanelTab_description(),
    action: withRoute((path) => closeActivePanelTab(store, path)),
  });
  register({
    ...mod,
    key: 'w',
    shift: true,
    global: true,
    description: m.workspace_shortcuts_closeSpaceTab_description(),
    action: withRoute((path) => closeActiveWorkspaceTab(store, path, navigate)),
  });
  register({
    ...mod,
    key: 't',
    shift: true,
    global: true,
    description: m.workspace_shortcuts_reopenClosedTabOrSpace_description(),
    action: withRoute((path) => reopenPanelOrWorkspaceTab(store, path, navigate)),
  });

  for (const [direction, shift] of [
    ['next', false],
    ['previous', true],
  ] as const) {
    register({
      key: 'Tab',
      ctrl: true,
      shift,
      global: true,
      description:
        direction === 'next'
          ? m.workspace_shortcuts_nextSpaceTab_description()
          : m.workspace_shortcuts_previousSpaceTab_description(),
      action: withRoute((path) => cycleWorkspaceTab(store, direction, path, navigate)),
    });
  }

  for (let digit = 1; digit <= 9; digit++) {
    register({
      ...mod,
      key: String(digit),
      global: true,
      description:
        digit === 9
          ? m.workspace_shortcuts_selectLastSpaceTab_description()
          : m.workspace_shortcuts_selectSpaceTab_description({ digit }),
      action: withRoute((path) =>
        selectWorkspaceTabByPosition(store, digit === 9 ? 'last' : digit - 1, path, navigate),
      ),
    });
  }
}

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
  closePanel,
  closeActiveTab,
  openBlankWorkingPanel,
  reopenClosedTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  selectPanels,
  selectFocusedPanelId,
  selectRecentlyClosed,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { resolveEmptyWindowDestination } from './empty-window-destination';
import type { KeyboardShortcut } from '$lib/utils/keyboardShortcuts';
import { m } from '$shared/paraglide/messages.js';
import { SHORTCUTS, getShortcutChord } from '$lib/utils/shortcuts';
import { isWorkspaceViewModeRoute } from '$features/workspace/workspace-view-mode-action';

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
      | ReturnType<typeof closePanel>
      | ReturnType<typeof closeActiveTab>
      | ReturnType<typeof openBlankWorkingPanel>
      | ReturnType<typeof reopenClosedTab>,
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

function resolveCloseTarget(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
): { workspaceId: string; layoutId: string } | null {
  if (selectWorkspaceViewMode.select(store.state) === 'columns') {
    const workspaceId = selectCurrentWorkspaceTabId.select(store.state);
    return workspaceId ? { workspaceId, layoutId: workspaceId } : null;
  }

  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match?.[1];
  return workspaceId && workspaceId !== 'new' ? { workspaceId, layoutId: workspaceId } : null;
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
  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match?.[1];
  if (!workspaceId || workspaceId === 'new') return null;

  return closeWorkspaceTabById(store, workspaceId, currentPath, navigate);
}

/**
 * Contextual Cmd+W: close the focused panel first; when only one panel
 * remains, close its tabs; once nothing is open, close the workspace tab.
 */
export function closePanelOrWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): 'panel' | 'tab' | 'workspace' | null {
  const target = resolveCloseTarget(store, currentPath);
  if (!target) return null;
  const { workspaceId, layoutId } = target;

  const panels = selectPanels.select(store.state, layoutId);
  const panelIds = Object.keys(panels);
  const focusedPanelId = selectFocusedPanelId.select(store.state, layoutId);

  if (panelIds.length > 1) {
    const targetId = focusedPanelId && panels[focusedPanelId] ? focusedPanelId : panelIds[0];
    store.dispatch(closePanel(layoutId, targetId));
    return 'panel';
  }

  const lastPanel = (focusedPanelId ? panels[focusedPanelId] : undefined) ?? panels[panelIds[0]];
  if (lastPanel && lastPanel.tabs.length > 0) {
    store.dispatch(closeActiveTab(layoutId, lastPanel.id));
    return 'tab';
  }

  closeWorkspaceTabById(store, workspaceId, currentPath, navigate);
  return 'workspace';
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
 * Contextual Cmd+Shift+T: reopen whichever closed most recently — a panel tab
 * (including tabs recorded when a whole panel closed) or a workspace tab —
 * by comparing close timestamps across both slices.
 */
export function reopenPanelOrWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  currentPath: string,
  navigate: (path: string) => unknown,
): 'tab' | 'workspace' | null {
  const match = currentPath.match(/^\/workspace\/([^/]+)/);
  const workspaceId = match && match[1] !== 'new' ? match[1] : null;

  const lastClosedWorkspace = selectLastClosedWorkspaceTab.select(store.state);
  const lastClosedPanelTab = workspaceId
    ? (selectRecentlyClosed.select(store.state, workspaceId)[0] ?? null)
    : null;

  if (
    workspaceId &&
    lastClosedPanelTab &&
    (!lastClosedWorkspace || lastClosedPanelTab.closedAt >= lastClosedWorkspace.closedAt)
  ) {
    store.dispatch(reopenClosedTab(workspaceId));
    return 'tab';
  }

  if (lastClosedWorkspace) {
    reopenWorkspaceTab(store, currentPath, navigate);
    return 'workspace';
  }

  return null;
}

/**
 * Cmd+T: clear or create the reusable working panel on the current workspace route.
 */
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
    description: m.workspace_shortcuts_closePanelTabOrSpace_description(),
    action: withRoute((path) => closePanelOrWorkspaceTab(store, path, navigate)),
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

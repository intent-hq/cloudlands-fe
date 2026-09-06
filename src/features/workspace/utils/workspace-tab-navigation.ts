import type { StoreState } from '$store/renderer/types';
import {
  closeWorkspaceTab,
  moveWorkspace,
  reopenLastClosedWorkspaceTab,
  switchToWorkspaceTabByIndex,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectCurrentWorkspaceTabId,
  selectLastClosedWorkspaceTab,
  selectWorkspaceTabOrder,
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
import type { ShortcutId } from '$lib/utils/shortcut-bindings';
import { getPanelKeyboardShortcuts } from '$features/layout/panel-keyboard-shortcuts.svelte';
import type { WorkspaceTabMovedEventDetail } from './workspace-tab-move-event';

export type WorkspaceTabDirection = 'next' | 'previous';

interface WorkspaceTabNavigationStore {
  readonly state: StoreState;
  dispatch(
    action:
      | ReturnType<typeof switchToNextWorkspaceTab>
      | ReturnType<typeof switchToPreviousWorkspaceTab>
      | ReturnType<typeof switchToWorkspaceTabByIndex>
      | ReturnType<typeof closeWorkspaceTab>
      | ReturnType<typeof moveWorkspace>
      | ReturnType<typeof reopenLastClosedWorkspaceTab>
      | ReturnType<typeof closeFocusedPanelTab>
      | ReturnType<typeof openBlankWorkingPanel>
      | ReturnType<typeof reopenClosedPanelColumn>
      | ReturnType<typeof reopenClosedTab>
      | ReturnType<typeof toggleSidebar>,
  ): unknown;
}

type RegisterShortcut = (shortcut: KeyboardShortcut) => void;

export type WorkspaceTabMoveDirection = 'left' | 'right';

export function moveActiveWorkspaceTab(
  store: WorkspaceTabNavigationStore,
  direction: WorkspaceTabMoveDirection,
): string | null {
  const order = selectWorkspaceTabOrder.select(store.state);
  const workspaceId = selectCurrentWorkspaceTabId.select(store.state);
  if (!workspaceId) return null;
  const currentIndex = order.indexOf(workspaceId);
  const targetIndex = currentIndex + (direction === 'left' ? -1 : 1);
  const targetWorkspaceId = order[targetIndex];
  if (currentIndex < 0 || !targetWorkspaceId) return null;
  store.dispatch(
    moveWorkspace(workspaceId, targetWorkspaceId, direction === 'left' ? 'before' : 'after'),
  );
  return workspaceId;
}

interface RegisterWorkspaceTabShortcutsOptions {
  isMac: boolean;
  register: RegisterShortcut;
  store: WorkspaceTabNavigationStore;
  getCurrentPath: () => string;
  navigate: (path: string) => unknown;
  openNewWorkspace: () => void;
  onCreateAgent?: (workspaceId: string) => void;
  onCreateNote?: (workspaceId: string) => void;
  onCreateTerminal?: (workspaceId: string) => void;
  onCreateBrowser?: (workspaceId: string) => void;
  onWorkspaceTabMoved?: (detail: WorkspaceTabMovedEventDetail) => void;
  resolveBinding?: (id: ShortcutId) => string;
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

  return null;
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

/** Close focused content, collapsing its structural column when it becomes empty. */
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
  const canRemoveColumn =
    selectPanelColumnCount.select(store.state, workspaceId) > 1 &&
    (isEmpty ||
      (panel.tabs.length === 1 && activeTab !== undefined && activeTab.closable !== false));
  if ((!activeTab || activeTab.closable === false) && !canRemoveColumn) return null;

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
  onCreateAgent,
  onCreateNote,
  onCreateTerminal,
  onCreateBrowser,
  onWorkspaceTabMoved,
  resolveBinding,
}: RegisterWorkspaceTabShortcutsOptions): void {
  const mod = isMac ? { meta: true } : { ctrl: true };
  const sidebarChord = getShortcutChord('TOGGLE_SIDEBAR', isMac);
  const withRoute = (action: (currentPath: string) => unknown) => () => action(getCurrentPath());
  const withWorkspace = (action: (workspaceId: string) => void) => () => {
    const match = getCurrentPath().match(/^\/workspace\/([^/]+)/);
    if (match?.[1] && match[1] !== 'new') action(match[1]);
  };
  const effective = (id: ShortcutId) =>
    resolveBinding ? { binding: () => resolveBinding(id) } : {};

  register({
    ...effective('global.new-space'),
    ...mod,
    key: 'n',
    global: true,
    description: m.workspace_shortcuts_newSpace_description(),
    action: openNewWorkspace,
  });
  register({
    ...effective('panel.toggle-sidebar'),
    ...sidebarChord,
    global: true,
    description: SHORTCUTS.TOGGLE_SIDEBAR.label,
    action: () => store.dispatch(toggleSidebar()),
  });
  register({
    ...effective('navigation.new-tab'),
    ...mod,
    key: 't',
    global: true,
    description: m.workspace_shortcuts_newPanel_description(),
    action: withRoute((path) => openNewPanel(store, path)),
  });
  for (const [id, key, description, action] of [
    ['workspace.new-agent', 'a', m.ui_shortcuts_newAgent_label(), onCreateAgent],
    [
      'workspace.new-note',
      'n',
      m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_note_label(),
      }),
      onCreateNote,
    ],
    [
      'workspace.new-terminal',
      't',
      m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_terminal_label(),
      }),
      onCreateTerminal,
    ],
    [
      'workspace.new-browser',
      'b',
      m.layout_panelEmptyState_newItem_tooltip({
        label: m.layout_panelEmptyState_browser_label(),
      }),
      onCreateBrowser,
    ],
  ] as const) {
    if (!action) continue;
    register({
      ...effective(id),
      ...mod,
      key,
      alt: true,
      global: true,
      description,
      action: withWorkspace(action),
    });
  }
  register({
    ...effective('navigation.close-tab'),
    ...mod,
    key: 'w',
    global: true,
    description: m.workspace_shortcuts_closePanelTab_description(),
    action: withRoute((path) => closeActivePanelTab(store, path)),
  });
  register({
    ...effective('navigation.close-space-tab'),
    ...mod,
    key: 'w',
    shift: true,
    global: true,
    description: m.workspace_shortcuts_closeSpaceTab_description(),
    action: withRoute((path) => closeActiveWorkspaceTab(store, path, navigate)),
  });
  register({
    ...effective('navigation.reopen-tab'),
    ...mod,
    key: 't',
    shift: true,
    global: true,
    description: m.workspace_shortcuts_reopenClosedTabOrSpace_description(),
    action: withRoute((path) => reopenPanelOrWorkspaceTab(store, path, navigate)),
  });

  register({
    ...effective('navigation.move-space-tab-left'),
    ...mod,
    key: 'ArrowLeft',
    alt: true,
    shift: true,
    global: true,
    description: SHORTCUTS.MOVE_SPACE_TAB_LEFT.label,
    action: () => {
      const workspaceId = moveActiveWorkspaceTab(store, 'left');
      if (!workspaceId) return;
      onWorkspaceTabMoved?.({
        workspaceId,
        position: selectWorkspaceTabOrder.select(store.state).indexOf(workspaceId) + 1,
      });
    },
  });
  register({
    ...effective('navigation.move-space-tab-right'),
    ...mod,
    key: 'ArrowRight',
    alt: true,
    shift: true,
    global: true,
    description: SHORTCUTS.MOVE_SPACE_TAB_RIGHT.label,
    action: () => {
      const workspaceId = moveActiveWorkspaceTab(store, 'right');
      if (!workspaceId) return;
      onWorkspaceTabMoved?.({
        workspaceId,
        position: selectWorkspaceTabOrder.select(store.state).indexOf(workspaceId) + 1,
      });
    },
  });

  for (const [direction, shift] of [
    ['next', false],
    ['previous', true],
  ] as const) {
    register({
      ...effective(direction === 'next' ? 'global.next-space' : 'global.previous-space'),
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
      ...(resolveBinding
        ? {
            binding: () => {
              const pattern = resolveBinding('navigation.go-to-tab');
              return pattern.replace(/([1-8])-9$/, String(digit));
            },
          }
        : {}),
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

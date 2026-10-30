import { createWorkspaceMicroKeyMenu } from '$features/hardware-console/assignment/workspace-key-menu';
import { tick } from 'svelte';
import { homeNewLabel } from './home-new-label.svelte';
import { homeLabelGroupKey } from './home-workspace-labels';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import {
  setWorkspaceAutoArchiveDisabled,
  setWorkspaceLabel,
  togglePinWorkspace,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  selectCanSetWorkspaceAutoArchive,
  selectCanSetWorkspaceLabel,
  selectWorkspaceAutoArchiveDisabled,
  selectLabelsSupported,
  selectWorkspaceLabel,
  selectWorkspaceLabelsInUse,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import { isPinnedWorkspaceLabel } from '$store/renderer/slices/sidebar-nav/workspace-labels';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  requestArchiveWorkspace,
  requestUnarchiveWorkspace,
  requestDeleteWorkspace,
  requestRetireWorkspace,
} from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import {
  faThumbtack,
  faTag,
  faBoxArchive,
  faBoxOpen,
  faTrash,
  faArrowRight,
  faArrowDown,
  faArrowUp,
  faHardDrive,
} from '@fortawesome/free-solid-svg-icons';

interface HomeWorkspaceMenuOptions {
  pinned: boolean;
  microConnected: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** Expand a Home list group (`pinned` or `label:<name>`). */
  expandGroup: (key: string) => void;
  getHomeElement: () => HTMLElement | null;
  /** Personal Home shelf state; omit to hide Set aside / Bring back. */
  aside?: { setAside: boolean; onToggle: () => void };
}

/** Return focus to a workspace's Home row once it has re-rendered (possibly in a new group). */
export function focusHomeWorkspaceRow(
  getHomeElement: () => HTMLElement | null,
  workspaceId: string,
): void {
  void tick().then(() => {
    requestAnimationFrame(() =>
      getHomeElement()
        ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspaceId)}"]`)
        ?.closest<HTMLElement>('[role="option"], button')
        ?.focus(),
    );
  });
}

function createLabelSubmenu(
  workspace: Workspace,
  { onClose, expandGroup, getHomeElement }: HomeWorkspaceMenuOptions,
): SidebarMenuItem {
  const current = selectWorkspaceLabel.select(store.state, workspace.id);
  const custom = current !== null && !isPinnedWorkspaceLabel(current) ? current : null;
  // Labels match ignoring case, like the name rules; the in-use list keeps one spelling.
  const isCurrent = (label: string) =>
    custom !== null && label.trim().toLocaleLowerCase() === custom.trim().toLocaleLowerCase();
  const choices: SidebarMenuItem[] = selectWorkspaceLabelsInUse
    .select(store.state)
    .map((label) => ({
      id: homeLabelGroupKey(label),
      label,
      checked: isCurrent(label),
      closeOnSelect: true,
      onClick: () => {
        onClose();
        if (isCurrent(label)) return;
        store.dispatch(setWorkspaceLabel(workspace.id, label));
        expandGroup(homeLabelGroupKey(label));
        focusHomeWorkspaceRow(getHomeElement, workspace.id);
      },
    }));
  return {
    id: 'label',
    label: m.home_workspaceLabel_menu_label(),
    icon: faTag,
    selection: 'single',
    onClick: () => {},
    submenu: [
      ...choices,
      {
        id: 'new-label',
        label: m.home_workspaceLabel_new_label(),
        onClick: () => {
          onClose();
          homeNewLabel.open({ workspaceId: workspace.id, expandGroup, getHomeElement });
        },
      },
      ...(custom === null
        ? []
        : [
            {
              id: 'remove-label',
              label: m.home_workspaceLabel_remove_label(),
              onClick: () => {
                onClose();
                store.dispatch(setWorkspaceLabel(workspace.id, null));
                focusHomeWorkspaceRow(getHomeElement, workspace.id);
              },
            },
          ]),
    ],
  };
}

export function createHomeWorkspaceMenu(
  workspace: Workspace,
  options: HomeWorkspaceMenuOptions,
): SidebarMenuEntry[] {
  const { pinned, microConnected, onOpen, onClose, expandGroup, getHomeElement } = options;
  // On a label-capable daemon a pin is the owner-only "pinned" label; older
  // daemons keep pins local, so everyone may still pin there.
  const canSetLabel = selectCanSetWorkspaceLabel.select(store.state, workspace.id);
  const canPin = !selectLabelsSupported.select(store.state) || canSetLabel;
  const items: SidebarMenuEntry[] = [
    {
      id: 'open',
      label: m.home_open_workspace(),
      icon: faArrowRight,
      shortcut: `Cmd+${m.chat_toolClassifier_click_label().toLowerCase()}`,
      onClick: () => onOpen(workspace.id),
    },
  ];
  if (canPin) {
    items.push({
      id: 'pin',
      label: pinned ? m.workspace_card_unpin_ariaLabel() : m.workspace_card_pin_ariaLabel(),
      icon: faThumbtack,
      onClick: () => {
        onClose();
        store.dispatch(togglePinWorkspace(workspace.id));
        if (!pinned) expandGroup('pinned');
        focusHomeWorkspaceRow(getHomeElement, workspace.id);
      },
    });
  }
  if (canSetLabel) items.push(createLabelSubmenu(workspace, options));
  // Set aside is personal Home organization, so collaborators may use it too;
  // archived work already lives in its own view.
  const live =
    workspace.status !== WorkspaceStatusEnum.Archived &&
    workspace.status !== WorkspaceStatusEnum.Retired;
  if (options.aside && live) {
    const { setAside, onToggle } = options.aside;
    items.push({
      id: 'set-aside',
      label: setAside ? m.home_setAside_bringBack_label() : m.home_setAside_action_label(),
      icon: setAside ? faArrowUp : faArrowDown,
      onClick: () => {
        onClose();
        onToggle();
      },
    });
  }
  items.push(...createWorkspaceMicroKeyMenu(workspace.id, { connected: microConnected, onClose }));
  if (!selectHidesOwnerWorkspaceActions.select(store.state, workspace.id)) {
    // Archive is the only lifecycle action users see. A Retired workspace
    // (PROTOCOL §5.1; its folder was purged) is presented as archived, and
    // unarchiving revives it as a fresh checkout. Purging the folder
    // (`workspace.retire`) is offered only on an archived workspace that
    // still has its folder.
    const retired = workspace.status === WorkspaceStatusEnum.Retired;
    const archived = retired || workspace.status === WorkspaceStatusEnum.Archived;
    items.push({ type: 'separator' });
    // Per-workspace opt-out from the daemon's auto-archive sweep (PROTOCOL
    // §5.1); owner-only, offered on daemons that advertise it.
    if (selectCanSetWorkspaceAutoArchive.select(store.state, workspace.id)) {
      items.push({
        id: 'disable-auto-archive',
        label: m.home_workspace_disableAutoArchive_label(),
        checked: selectWorkspaceAutoArchiveDisabled.select(store.state, workspace.id),
        closeOnSelect: true,
        onClick: () => {
          onClose();
          // Read at click time: the flag may have changed while the menu was open.
          const disabled = selectWorkspaceAutoArchiveDisabled.select(store.state, workspace.id);
          store.dispatch(setWorkspaceAutoArchiveDisabled(workspace.id, !disabled));
        },
      });
    }
    items.push(
      {
        id: 'archive',
        label: archived
          ? m.ui_workspaceActions_unarchiveSpace_label()
          : m.workspace_card_archive_label(),
        icon: archived ? faBoxOpen : faBoxArchive,
        onClick: () => {
          onClose();
          store.dispatch(
            archived
              ? requestUnarchiveWorkspace(workspace.id)
              : requestArchiveWorkspace(workspace.id),
          );
        },
      },
      ...(archived && !retired
        ? [
            {
              id: 'purge',
              label: m.workspace_purge_menu_label(),
              icon: faHardDrive,
              onClick: () => {
                onClose();
                store.dispatch(requestRetireWorkspace(workspace.id));
              },
            },
          ]
        : []),
      {
        id: 'delete',
        label: m.workspace_card_deleteSpace_label(),
        icon: faTrash,
        destructive: true,
        onClick: () => {
          onClose();
          store.dispatch(requestDeleteWorkspace(workspace.id));
        },
      },
    );
  }
  return items;
}

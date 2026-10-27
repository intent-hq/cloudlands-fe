import { createWorkspaceMicroKeyMenu } from '$features/hardware-console/assignment/workspace-key-menu';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  requestArchiveWorkspace,
  requestUnarchiveWorkspace,
  requestDeleteWorkspace,
  requestRetireWorkspace,
} from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import {
  faThumbtack,
  faBoxArchive,
  faBoxOpen,
  faTrash,
  faArrowRight,
  faHardDrive,
} from '@fortawesome/free-solid-svg-icons';

interface HomeWorkspaceMenuOptions {
  pinned: boolean;
  microConnected: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onPin: () => void;
}

export function createHomeWorkspaceMenu(
  workspace: Workspace,
  { pinned, microConnected, onOpen, onClose, onPin }: HomeWorkspaceMenuOptions,
): SidebarMenuEntry[] {
  const items: SidebarMenuEntry[] = [
    {
      id: 'open',
      label: m.home_open_workspace(),
      icon: faArrowRight,
      shortcut: `Cmd+${m.chat_toolClassifier_click_label().toLowerCase()}`,
      onClick: () => onOpen(workspace.id),
    },
    {
      id: 'pin',
      label: pinned ? m.workspace_card_unpin_ariaLabel() : m.workspace_card_pin_ariaLabel(),
      icon: faThumbtack,
      onClick: () => {
        onClose();
        onPin();
      },
    },
  ];
  items.push(...createWorkspaceMicroKeyMenu(workspace.id, { connected: microConnected, onClose }));
  if (!selectHidesOwnerWorkspaceActions.select(store.state, workspace.id)) {
    // Archive is the only lifecycle action users see. A Retired workspace
    // (PROTOCOL §5.1; its folder was purged) is presented as archived, and
    // unarchiving revives it as a fresh checkout. Purging the folder
    // (`workspace.retire`) is offered only on an archived workspace that
    // still has its folder.
    const retired = workspace.status === WorkspaceStatusEnum.Retired;
    const archived = retired || workspace.status === WorkspaceStatusEnum.Archived;
    items.push(
      { type: 'separator' },
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

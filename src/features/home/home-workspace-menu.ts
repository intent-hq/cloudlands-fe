import { tick } from 'svelte';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  requestArchiveWorkspace,
  requestUnarchiveWorkspace,
  requestDeleteWorkspace,
} from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import {
  faThumbtack,
  faBoxArchive,
  faBoxOpen,
  faTrash,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';

interface HomeWorkspaceMenuOptions {
  pinned: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  expandPinned: () => void;
  getHomeElement: () => HTMLElement | null;
}

export function createHomeWorkspaceMenu(
  workspace: Workspace,
  { pinned, onOpen, onClose, expandPinned, getHomeElement }: HomeWorkspaceMenuOptions,
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
        store.dispatch(togglePinWorkspace(workspace.id));
        if (!pinned) expandPinned();
        void tick().then(() =>
          getHomeElement()
            ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspace.id)}"]`)
            ?.closest<HTMLElement>('[role="option"]')
            ?.focus(),
        );
      },
    },
  ];
  if (!selectHidesOwnerWorkspaceActions.select(store.state, workspace.id)) {
    const archived = workspace.status === WorkspaceStatusEnum.Archived;
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

import { store as appStore } from '$store/renderer/store';
import {
  markKeySlotUnassigned,
  pinWorkspaceToKey,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import {
  selectWorkspacePinnedKeySlot,
  selectWorkspaceResolvedKeySlot,
  selectHardwareConsoleKeySlots,
} from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  AGENT_KEY_COUNT,
  isKeyAssignableWorkspace,
} from '$features/hardware-console/assignment/key-assignment';
import { faKeyboard } from '@fortawesome/free-solid-svg-icons';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

function canAssignWorkspace(workspaceId: string): boolean {
  const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
  return workspace !== undefined && isKeyAssignableWorkspace(workspace);
}

/** Snapshot the existing six-slot commands; callers subscribe to connection state at init. */
export function createMicroKeyAssignmentItems(
  workspaceId: string,
  closeMenu: () => void,
): SidebarMenuEntry[] {
  if (!canAssignWorkspace(workspaceId)) return [];
  const pinnedSlot = selectWorkspacePinnedKeySlot.select(appStore.state, workspaceId);
  const resolvedSlot = selectWorkspaceResolvedKeySlot.select(appStore.state, workspaceId);
  const occupiedSlots = selectHardwareConsoleKeySlots.select(appStore.state);
  const items: SidebarMenuEntry[] = [];
  for (let target = 0; target < AGENT_KEY_COUNT; target += 1) {
    const occupantId = occupiedSlots[target];
    const occupant =
      occupantId && occupantId !== workspaceId
        ? selectWorkspaceById.select(appStore.state, occupantId)
        : undefined;
    items.push({
      id: `assign-micro-key-${target + 1}`,
      label: occupant
        ? m.workspace_card_assignOccupiedMicroKey_label({
            number: formatInteger(target + 1),
            title: occupant.title,
          })
        : m.workspace_card_assignMicroKeyNumber_label({
            number: formatInteger(target + 1),
          }),
      checked: pinnedSlot === target,
      closeOnSelect: true,
      onClick: () => {
        // The workspace may have been archived or removed while the menu was open.
        if (canAssignWorkspace(workspaceId)) {
          appStore.dispatch(pinWorkspaceToKey(target, workspaceId));
        }
        closeMenu();
      },
    });
  }
  if (resolvedSlot !== null) {
    items.push({ type: 'separator' });
    items.push({
      id: 'unassign-micro-key',
      label: m.workspace_card_unassignMicroKey_label(),
      onClick: () => {
        if (
          canAssignWorkspace(workspaceId) &&
          selectWorkspaceResolvedKeySlot.select(appStore.state, workspaceId) === resolvedSlot
        ) {
          appStore.dispatch(markKeySlotUnassigned(resolvedSlot));
        }
        closeMenu();
      },
    });
  }
  return items;
}

/** Workspace context-menu form, shared by cards, Home and tabs. */
export function createWorkspaceMicroKeyMenu(
  workspaceId: string,
  { connected, onClose }: { connected: boolean; onClose: () => void },
): SidebarMenuEntry[] {
  if (!connected) return [];
  const commands = createMicroKeyAssignmentItems(workspaceId, onClose);
  if (commands.length === 0) return [];
  const assignments = commands.filter(
    (entry): entry is SidebarMenuItem => 'id' in entry && entry.id !== 'unassign-micro-key',
  );
  const unassign = commands.find((entry) => 'id' in entry && entry.id === 'unassign-micro-key');
  return [
    {
      id: 'assign-micro-key',
      label: m.workspace_card_assignMicroKey_label(),
      icon: faKeyboard,
      onClick: () => {},
      selection: 'single',
      submenu: assignments,
    },
    ...(unassign ? [unassign] : []),
  ];
}

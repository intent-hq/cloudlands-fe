import { faHardDrive } from '$lib/icons/phosphor-icons';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { moveHomeDialogOpened } from './workspace-home-slice';

/** The workspace menu's "Move home…" item (owners and managers, no move running). */
export function moveHomeMenuAction(workspaceId: string) {
  return {
    id: 'move-workspace-home',
    label: m.workspaceHome_move_label(),
    icon: faHardDrive,
    onClick: () => appStore.dispatch(moveHomeDialogOpened(workspaceId)),
  };
}

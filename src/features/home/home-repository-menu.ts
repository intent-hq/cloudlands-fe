import { faEye, faEyeSlash, faPlus } from '@fortawesome/free-solid-svg-icons';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { m } from '$shared/paraglide/messages.js';

export interface HomeRepositoryMenuOptions {
  canCreate: boolean;
  hidden: boolean;
  /** Hiding records the newest workspace, so it waits for the full list. */
  loaded: boolean;
  onNewWorkspace: () => void;
  onHide: () => void;
  onUnhide: () => void;
}

/** Right-click menu for a repository or local folder in the Home sidebar. */
export function createHomeRepositoryMenu(options: HomeRepositoryMenuOptions): SidebarMenuEntry[] {
  return [
    ...(options.canCreate
      ? [
          {
            id: 'new-workspace',
            label: m.home_new_workspace(),
            icon: faPlus,
            onClick: options.onNewWorkspace,
          },
        ]
      : []),
    options.hidden
      ? {
          id: 'unhide',
          label: m.home_repository_menu_unhide_label(),
          icon: faEye,
          onClick: options.onUnhide,
        }
      : {
          id: 'hide',
          label: m.home_repository_menu_hide_label(),
          icon: faEyeSlash,
          disabled: !options.loaded,
          onClick: options.onHide,
        },
  ];
}

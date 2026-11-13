import { faEye, faEyeSlash, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import type { RepositoryGroup } from '$lib/components/workspace/utils/workspace-grouping';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { removeRecentRepository } from '$store/renderer/slices/known-repos/known-repos-slice';
import { newestHomeRepositoryWorkspace } from './home-hidden-repos';
import { homeRepositoriesUnhidden, homeRepositoryHidden } from './home-workspaces-slice';

export interface HomeRepositoryMenuOptions {
  repo: RepositoryGroup;
  canCreate: boolean;
  hidden: boolean;
  /** Hiding records the newest workspace, so it waits for the full list. */
  loaded: boolean;
  onNewWorkspace: () => void;
  /** Runs before the menu closes for any action. */
  onClose: () => void;
  /** Runs before the repository leaves the sidebar. */
  onLeave: () => void;
}

/**
 * Right-click menu for a repository or local folder in the Home sidebar. Local folders
 * are deleted from the recent list; GitHub repositories are hidden.
 */
export function createHomeRepositoryMenu(options: HomeRepositoryMenuOptions): SidebarMenuEntry[] {
  const { repo } = options;
  const then = (action: () => void) => () => {
    options.onClose();
    action();
  };
  const hide = () =>
    store.dispatch(homeRepositoryHidden(repo.key, newestHomeRepositoryWorkspace(repo.workspaces)));
  return [
    ...(options.canCreate
      ? [
          {
            id: 'new-workspace',
            label: m.home_new_workspace(),
            icon: faPlus,
            onClick: then(options.onNewWorkspace),
          },
        ]
      : []),
    options.hidden
      ? {
          id: 'unhide',
          label: m.home_repository_menu_unhide_label(),
          icon: faEye,
          onClick: then(() => store.dispatch(homeRepositoriesUnhidden([repo.key]))),
        }
      : !repo.owner
        ? {
            id: 'delete',
            label: m.menu_delete(),
            icon: faTrash,
            destructive: true,
            disabled: !options.loaded,
            onClick: then(() => {
              options.onLeave();
              if (repo.repoPath) store.dispatch(removeRecentRepository(repo.repoPath));
              // Existing workspaces would keep the folder listed, so it is also hidden.
              if (repo.workspaces.length) hide();
            }),
          }
        : {
            id: 'hide',
            label: m.home_repository_menu_hide_label(),
            icon: faEyeSlash,
            disabled: !options.loaded,
            onClick: then(() => {
              options.onLeave();
              hide();
            }),
          },
  ];
}

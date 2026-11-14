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
 * owners delete from the recent list; GitHub repositories, and collaborators, hide.
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
      : // Collaborators must not edit the host's recent list.
        !repo.owner && options.canCreate
        ? {
            id: 'delete',
            label: m.menu_delete(),
            icon: faTrash,
            destructive: true,
            disabled: !options.loaded,
            onClick: then(() => {
              options.onLeave();
              // Existing workspaces would keep the folder listed, so it is also hidden.
              const hidden = repo.workspaces.length > 0;
              if (hidden) hide();
              if (repo.repoPath)
                store.dispatch(
                  hidden
                    ? removeRecentRepository(repo.repoPath, repo.key)
                    : removeRecentRepository(repo.repoPath),
                );
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

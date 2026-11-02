import { m } from '$shared/paraglide/messages.js';

/**
 * What the folder-picker git switch acts on: a picked git repository, a
 * picked folder without git, a new folder (the New tab), or nothing picked yet.
 */
export type GitSwitchFolder = 'git-repo' | 'folder' | 'new' | null;

/**
 * Label and hint for the git switch (Labs plain folders), named for the folder
 * it acts on. Each name has one fixed sentence that explains the term; the
 * hint does not describe On and Off (user decision). Before a pick the switch
 * reads as the git-repo choice, the common case for the Existing folder tab.
 */
export function gitSwitchCopy(folder: GitSwitchFolder): { label: string; description: string } {
  return folder === 'folder' || folder === 'new'
    ? {
        label: m.workspace_plainFolder_initializeGit_label(),
        description: m.workspace_plainFolder_initializeGit_description(),
      }
    : {
        label: m.workspace_plainFolder_switchGitRepo_label(),
        description: m.workspace_plainFolder_switchGitRepo_description(),
      };
}

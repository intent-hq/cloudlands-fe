import { m } from '$shared/paraglide/messages.js';

/**
 * What the folder-picker git switch acts on: a picked git repository, a
 * picked folder without git, a new folder (the New tab), or nothing picked yet.
 */
export type GitSwitchFolder = 'git-repo' | 'folder' | 'new' | null;

/**
 * Label and hint for the git switch (Labs plain folders). The switch means a
 * different thing per folder, so its copy says what really happens:
 * a git repo gets a new branch in a separate worktree (on) or is used in
 * place on its current branch (off); any other folder is git-initialized in
 * place and worked on on main (on) or used as a plain folder (off). Before a
 * pick the copy is neutral, since either meaning would be wrong for half the
 * folders a user might pick.
 */
export function gitSwitchCopy(
  folder: GitSwitchFolder,
  checked: boolean,
  branch = '',
): { label: string; description: string } {
  switch (folder) {
    case 'git-repo':
      return {
        label: m.workspace_plainFolder_switchGitRepo_label(),
        description: checked
          ? m.workspace_plainFolder_switchGitRepoOn_description()
          : branch
            ? m.workspace_plainFolder_switchGitRepoOff_description({ branch })
            : m.workspace_plainFolder_switchGitRepoOffCurrentBranch_description(),
      };
    case 'folder':
      return {
        label: m.workspace_plainFolder_initializeGit_label(),
        description: checked
          ? m.workspace_plainFolder_switchFolderOn_description()
          : m.workspace_plainFolder_switchFolderOff_description(),
      };
    case 'new':
      return {
        label: m.workspace_plainFolder_initializeGit_label(),
        description: checked
          ? m.workspace_plainFolder_switchNewOn_description()
          : m.workspace_plainFolder_switchNewOff_description(),
      };
    default:
      return {
        label: m.workspace_plainFolder_switchNeutral_label(),
        description: checked
          ? m.workspace_plainFolder_switchNeutralOn_description()
          : m.workspace_plainFolder_switchNeutralOff_description(),
      };
  }
}

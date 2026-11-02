import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { gitSwitchCopy } from '../git-switch-copy';

/**
 * The folder-picker git switch names what really happens for the picked
 * folder: a git repo branches into a worktree (on) or is used in place on its
 * current branch (off); any other folder, and a new one, is git-initialized
 * in place on main (on) or used as a plain folder (off).
 */
describe('gitSwitchCopy', () => {
  it('git repo: worktree on, in place on its branch off', () => {
    expect(gitSwitchCopy('git-repo', true, 'feature/x')).toEqual({
      label: m.workspace_plainFolder_switchGitRepo_label(),
      description: m.workspace_plainFolder_switchGitRepoOn_description(),
    });
    expect(gitSwitchCopy('git-repo', false, 'feature/x')).toEqual({
      label: m.workspace_plainFolder_switchGitRepo_label(),
      description: m.workspace_plainFolder_switchGitRepoOff_description({ branch: 'feature/x' }),
    });
    expect(gitSwitchCopy('git-repo', false, '').description).toBe(
      m.workspace_plainFolder_switchGitRepoOffCurrentBranch_description(),
    );
  });

  it('folder without git: git init in place on main, or a plain folder', () => {
    expect(gitSwitchCopy('folder', true)).toEqual({
      label: m.workspace_plainFolder_initializeGit_label(),
      description: m.workspace_plainFolder_switchFolderOn_description(),
    });
    expect(gitSwitchCopy('folder', false)).toEqual({
      label: m.workspace_plainFolder_initializeGit_label(),
      description: m.workspace_plainFolder_switchFolderOff_description(),
    });
  });

  it('new folder: created and git-initialized on main, or a plain folder', () => {
    expect(gitSwitchCopy('new', true)).toEqual({
      label: m.workspace_plainFolder_initializeGit_label(),
      description: m.workspace_plainFolder_switchNewOn_description(),
    });
    expect(gitSwitchCopy('new', false)).toEqual({
      label: m.workspace_plainFolder_initializeGit_label(),
      description: m.workspace_plainFolder_switchNewOff_description(),
    });
  });

  it('nothing picked yet: neutral, true for any folder', () => {
    expect(gitSwitchCopy(null, true)).toEqual({
      label: m.workspace_plainFolder_switchNeutral_label(),
      description: m.workspace_plainFolder_switchNeutralOn_description(),
    });
    expect(gitSwitchCopy(null, false)).toEqual({
      label: m.workspace_plainFolder_switchNeutral_label(),
      description: m.workspace_plainFolder_switchNeutralOff_description(),
    });
  });
});

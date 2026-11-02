import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { gitSwitchCopy } from '../git-switch-copy';

/**
 * The folder-picker git switch is named for the picked folder, with one fixed
 * sentence per name (user decision: the hint does not describe On and Off).
 */
describe('gitSwitchCopy', () => {
  const worktree = {
    label: m.workspace_plainFolder_switchGitRepo_label(),
    description: m.workspace_plainFolder_switchGitRepo_description(),
  };
  const initialize = {
    label: m.workspace_plainFolder_initializeGit_label(),
    description: m.workspace_plainFolder_initializeGit_description(),
  };

  it('a git repo: "Branch and use git worktree"', () => {
    expect(gitSwitchCopy('git-repo')).toEqual(worktree);
    expect(worktree.description).toBe(
      'A worktree is a separate copy of your repository on its own branch, so your folder stays untouched.',
    );
  });

  it('a folder without git and a new folder: "Initialize as git repository"', () => {
    expect(gitSwitchCopy('folder')).toEqual(initialize);
    expect(gitSwitchCopy('new')).toEqual(initialize);
    expect(initialize.description).toBe(
      'Turns this folder into a git repository so every change is tracked and can be undone.',
    );
  });

  it('nothing picked yet reads as the git-repo choice', () => {
    expect(gitSwitchCopy(null)).toEqual(worktree);
  });
});

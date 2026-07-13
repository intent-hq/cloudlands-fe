/**
 * Git Utilities
 *
 * Shared utility functions for git operations.
 */

import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Find the parent git repository root by walking up the directory tree.
 * Returns the path to the git root directory if found, undefined otherwise.
 *
 * This is useful for:
 * - Detecting if a directory is inside an existing git repository
 * - Finding the root of a monorepo when given a subdirectory path
 * - Determining the scope/relative path from git root to a subdirectory
 *
 * @param startPath - The directory path to start searching from
 * @returns The path to the git root directory, or undefined if not found
 */
export async function findParentGitDir(startPath: string): Promise<string | undefined> {
  let currentPath = startPath;
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    const gitDir = path.join(currentPath, '.git');
    try {
      const gitStats = await fs.stat(gitDir);
      if (gitStats.isDirectory()) {
        return currentPath;
      }
      if (gitStats.isFile()) {
        // In git worktrees, .git is a file containing "gitdir: /path/to/.git/worktrees/..."
        const content = await fs.readFile(gitDir, 'utf-8');
        if (content.trim().startsWith('gitdir:')) {
          return currentPath;
        }
      }
    } catch {
      // .git doesn't exist in this directory, continue walking up
    }

    currentPath = path.dirname(currentPath);
  }

  return undefined;
}

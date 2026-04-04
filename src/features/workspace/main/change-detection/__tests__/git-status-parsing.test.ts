/**
 * Git Status Parsing Tests
 *
 * Tests for git status parsing logic, specifically:
 * - Staged new files (git status 'A') should be tracked in stagedAdded
 * - Line counting for new files
 * - buildChangesFromStatus correctly assigns actions
 */

import { describe, it, expect } from 'vitest';
import type { GitStatus } from '../git-types';

/**
 * Parses git status output in porcelain format.
 * Extracted from git-operations-safe-wrapper.ts for testing.
 */
function parseGitStatusOutput(stdout: string): GitStatus {
  const status: GitStatus = {
    staged: [],
    stagedAdded: [],
    stagedDeleted: [],
    unstaged: [],
    untracked: [],
    deleted: [],
    renamed: new Map(),
  };

  const lines = stdout.split('\n').filter((line: string) => line.trim());

  for (const line of lines) {
    if (!line || line.length < 3) continue;

    const x = line[0];
    const y = line[1];
    const filePath = line.substring(3);

    // Skip directory paths
    if (filePath.endsWith('/')) {
      continue;
    }

    // Handle renamed files
    if (line.includes(' -> ')) {
      const [oldPath, newPath] = filePath.split(' -> ');
      status.renamed.set(oldPath, newPath);
      if (x === 'R') {
        status.staged.push(newPath);
      } else if (y === 'R') {
        status.unstaged.push(newPath);
      }
      continue;
    }

    // Staged changes
    if (x !== ' ' && x !== '?') {
      if (x === 'D') {
        // Staged deletion (file deleted and staged for commit)
        status.stagedDeleted.push(filePath);
      } else if (x === 'A') {
        // Staged new file (added to index but didn't exist in HEAD)
        status.stagedAdded.push(filePath);
      } else {
        status.staged.push(filePath);
      }
    }

    // Unstaged changes
    if (y !== ' ' && y !== '?') {
      if (y === 'D') {
        // Unstaged deletion (file deleted but not staged)
        if (!status.deleted.includes(filePath)) {
          status.deleted.push(filePath);
        }
      } else {
        status.unstaged.push(filePath);
      }
    }

    // Untracked files
    if (x === '?' && y === '?') {
      status.untracked.push(filePath);
    }
  }

  return status;
}

/**
 * Builds raw changes array from git status.
 * Extracted from change-detector-refactored.ts for testing.
 */
function buildChangesFromStatus(
  status: GitStatus,
): Array<{
  path: string;
  action: 'Create' | 'Modify' | 'Delete' | 'Rename';
  stage: 'staged' | 'unstaged';
  oldPath?: string;
}> {
  const changes: Array<{
    path: string;
    action: 'Create' | 'Modify' | 'Delete' | 'Rename';
    stage: 'staged' | 'unstaged';
    oldPath?: string;
  }> = [];

  // Build a set of renamed file paths to exclude them from staged/unstaged processing
  // (they get added to both status.renamed AND status.staged/unstaged in git-operations-safe-wrapper)
  const renamedNewPaths = new Set<string>(status.renamed.values());

  // Process staged files (modifications) - exclude renamed files
  for (const file of status.staged) {
    if (!renamedNewPaths.has(file)) {
      changes.push({ path: file, action: 'Modify', stage: 'staged' });
    }
  }

  // Process staged added files (new files that are staged)
  for (const file of status.stagedAdded) {
    changes.push({ path: file, action: 'Create', stage: 'staged' });
  }

  // Process unstaged files (modifications) - exclude renamed files
  for (const file of status.unstaged) {
    if (!renamedNewPaths.has(file)) {
      changes.push({ path: file, action: 'Modify', stage: 'unstaged' });
    }
  }

  // Process untracked files (new files)
  for (const file of status.untracked) {
    changes.push({ path: file, action: 'Create', stage: 'unstaged' });
  }

  // Process staged deleted files
  for (const file of status.stagedDeleted) {
    changes.push({ path: file, action: 'Delete', stage: 'staged' });
  }

  // Process unstaged deleted files
  for (const file of status.deleted) {
    changes.push({ path: file, action: 'Delete', stage: 'unstaged' });
  }

  // Process renamed files - determine stage from status.staged/unstaged presence
  for (const [oldPath, newPath] of status.renamed.entries()) {
    // Determine if the rename is staged or unstaged based on which list it's in
    const isStaged = status.staged.includes(newPath);
    changes.push({ path: newPath, action: 'Rename', stage: isStaged ? 'staged' : 'unstaged', oldPath });
  }

  return changes;
}

/**
 * Counts lines in content for new files.
 * Extracted from change-detector-refactored.ts for testing.
 */
function countLinesForNewFile(content: string): number {
  if (!content) return 0;
  let additions = content.split('\n').length;
  // Handle case where file doesn't end with newline
  if (content.endsWith('\n')) {
    additions = Math.max(0, additions - 1);
  }
  return additions;
}

describe('git-status-parsing', () => {
  describe('parseGitStatusOutput', () => {
    it('should parse staged new file (A status) into stagedAdded', () => {
      // 'A ' means staged new file (added to index)
      const stdout = 'A  src/components/NewComponent.svelte';
      const status = parseGitStatusOutput(stdout);

      expect(status.stagedAdded).toContain('src/components/NewComponent.svelte');
      expect(status.staged).not.toContain('src/components/NewComponent.svelte');
      expect(status.untracked).not.toContain('src/components/NewComponent.svelte');
    });

    it('should parse staged modified file (M in X column) into staged', () => {
      // 'M ' means staged modified file
      const stdout = 'M  src/app.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.staged).toContain('src/app.ts');
      expect(status.stagedAdded).not.toContain('src/app.ts');
    });

    it('should parse untracked file (??) into untracked', () => {
      const stdout = '?? src/new-untracked-file.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.untracked).toContain('src/new-untracked-file.ts');
      expect(status.stagedAdded).not.toContain('src/new-untracked-file.ts');
    });

    it('should parse unstaged modified file ( M) into unstaged', () => {
      // ' M' means unstaged modified file
      const stdout = ' M src/modified.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.unstaged).toContain('src/modified.ts');
    });

    it('should parse staged deleted file (D in X column) into stagedDeleted', () => {
      const stdout = 'D  src/deleted-file.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.stagedDeleted).toContain('src/deleted-file.ts');
      expect(status.deleted).not.toContain('src/deleted-file.ts');
    });

    it('should parse unstaged deleted file ( D) into deleted', () => {
      const stdout = ' D src/deleted-unstaged.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.deleted).toContain('src/deleted-unstaged.ts');
      expect(status.stagedDeleted).not.toContain('src/deleted-unstaged.ts');
    });

    it('should handle mixed status correctly', () => {
      const stdout = `A  src/new-staged.svelte
M  src/modified-staged.ts
 M src/modified-unstaged.ts
?? src/untracked.ts
D  src/staged-deleted.ts
 D src/unstaged-deleted.ts`;
      const status = parseGitStatusOutput(stdout);

      expect(status.stagedAdded).toEqual(['src/new-staged.svelte']);
      expect(status.staged).toEqual(['src/modified-staged.ts']);
      expect(status.unstaged).toEqual(['src/modified-unstaged.ts']);
      expect(status.untracked).toEqual(['src/untracked.ts']);
      expect(status.stagedDeleted).toEqual(['src/staged-deleted.ts']);
      expect(status.deleted).toEqual(['src/unstaged-deleted.ts']);
    });

    it('should handle renamed files', () => {
      const stdout = 'R  old-name.ts -> new-name.ts';
      const status = parseGitStatusOutput(stdout);

      expect(status.renamed.get('old-name.ts')).toBe('new-name.ts');
      expect(status.staged).toContain('new-name.ts');
    });

    it('should skip directory paths', () => {
      const stdout = '?? src/new-directory/';
      const status = parseGitStatusOutput(stdout);

      expect(status.untracked).not.toContain('src/new-directory/');
      expect(status.untracked).toHaveLength(0);
    });

    it('should NOT filter out .augment/ files (git is the source of truth)', () => {
      // When git reports .augment/ files in status, they are not gitignored
      // (e.g., .gitignore has negation like !.augment/skills/)
      const stdout = '?? .augment/skills/cognitive-complexity/README.md';
      const status = parseGitStatusOutput(stdout);

      expect(status.untracked).toContain('.augment/skills/cognitive-complexity/README.md');
      expect(status.untracked).toHaveLength(1);
    });

    it('should handle .augment/ files in mixed status output', () => {
      const stdout = `A  .augment/skills/my-skill/config.json
 M src/app.ts
?? .augment/skills/my-skill/index.ts
M  package.json`;
      const status = parseGitStatusOutput(stdout);

      expect(status.stagedAdded).toContain('.augment/skills/my-skill/config.json');
      expect(status.unstaged).toContain('src/app.ts');
      expect(status.untracked).toContain('.augment/skills/my-skill/index.ts');
      expect(status.staged).toContain('package.json');
    });
  });

  describe('buildChangesFromStatus', () => {
    it('should assign Create action to stagedAdded files', () => {
      const status: GitStatus = {
        staged: [],
        stagedAdded: ['src/new-component.svelte'],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/new-component.svelte',
        action: 'Create',
        stage: 'staged',
      });
    });

    it('should assign Create action to untracked files', () => {
      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: ['src/untracked-file.ts'],
        deleted: [],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/untracked-file.ts',
        action: 'Create',
        stage: 'unstaged',
      });
    });

    it('should assign Modify action to staged files', () => {
      const status: GitStatus = {
        staged: ['src/modified.ts'],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/modified.ts',
        action: 'Modify',
        stage: 'staged',
      });
    });

    it('should assign Modify action to unstaged files', () => {
      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: ['src/unstaged-modified.ts'],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/unstaged-modified.ts',
        action: 'Modify',
        stage: 'unstaged',
      });
    });

    it('should assign Delete action to unstaged deleted files', () => {
      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: ['src/deleted.ts'],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/deleted.ts',
        action: 'Delete',
        stage: 'unstaged',
      });
    });

    it('should assign Delete action to staged deleted files', () => {
      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: ['src/staged-deleted.ts'],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'src/staged-deleted.ts',
        action: 'Delete',
        stage: 'staged',
      });
    });

    it('should assign Rename action to renamed files', () => {
      const renamed = new Map<string, string>();
      renamed.set('old-name.ts', 'new-name.ts');

      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed,
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'new-name.ts',
        action: 'Rename',
        stage: 'unstaged',
        oldPath: 'old-name.ts',
      });
    });

    it('should process all types of changes together', () => {
      const renamed = new Map<string, string>();
      renamed.set('old.ts', 'new.ts');

      const status: GitStatus = {
        staged: ['modified-staged.ts'],
        stagedAdded: ['new-staged.ts'],
        stagedDeleted: [],
        unstaged: ['modified-unstaged.ts'],
        untracked: ['untracked.ts'],
        deleted: ['deleted.ts'],
        renamed,
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(6);

      const stagedModify = changes.find(c => c.path === 'modified-staged.ts');
      expect(stagedModify).toEqual({ path: 'modified-staged.ts', action: 'Modify', stage: 'staged' });

      const stagedCreate = changes.find(c => c.path === 'new-staged.ts');
      expect(stagedCreate).toEqual({ path: 'new-staged.ts', action: 'Create', stage: 'staged' });

      const unstagedModify = changes.find(c => c.path === 'modified-unstaged.ts');
      expect(unstagedModify).toEqual({ path: 'modified-unstaged.ts', action: 'Modify', stage: 'unstaged' });

      const untracked = changes.find(c => c.path === 'untracked.ts');
      expect(untracked).toEqual({ path: 'untracked.ts', action: 'Create', stage: 'unstaged' });

      const deleted = changes.find(c => c.path === 'deleted.ts');
      expect(deleted).toEqual({ path: 'deleted.ts', action: 'Delete', stage: 'unstaged' });

      const rename = changes.find(c => c.path === 'new.ts');
      expect(rename).toEqual({ path: 'new.ts', action: 'Rename', stage: 'unstaged', oldPath: 'old.ts' });
    });

    it('should not duplicate renamed files that are also in staged list', () => {
      // When a file is renamed, it appears in BOTH status.renamed AND status.staged
      // We should only report it once as a Rename, not also as a Modify
      const renamed = new Map<string, string>();
      renamed.set('old-name.ts', 'new-name.ts');

      const status: GitStatus = {
        staged: ['new-name.ts'], // Renamed file also appears in staged list
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed,
      };
      const changes = buildChangesFromStatus(status);

      // Should only have 1 change (Rename), not 2 (Rename + Modify)
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'new-name.ts',
        action: 'Rename',
        stage: 'staged',
        oldPath: 'old-name.ts',
      });
    });

    it('should not duplicate renamed files that are also in unstaged list', () => {
      // When a file is renamed with unstaged status, it appears in BOTH status.renamed AND status.unstaged
      const renamed = new Map<string, string>();
      renamed.set('old-name.ts', 'new-name.ts');

      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: ['new-name.ts'], // Renamed file also appears in unstaged list
        untracked: [],
        deleted: [],
        renamed,
      };
      const changes = buildChangesFromStatus(status);

      // Should only have 1 change (Rename), not 2 (Rename + Modify)
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        path: 'new-name.ts',
        action: 'Rename',
        stage: 'unstaged',
        oldPath: 'old-name.ts',
      });
    });

    it('should correctly set stage for staged renamed files', () => {
      const renamed = new Map<string, string>();
      renamed.set('old.ts', 'new.ts');

      const status: GitStatus = {
        staged: ['new.ts'], // File is in staged list
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed,
      };
      const changes = buildChangesFromStatus(status);

      expect(changes).toHaveLength(1);
      expect(changes[0].stage).toBe('staged'); // Stage should be 'staged', not 'unstaged'
    });
  });

  describe('countLinesForNewFile', () => {
    it('should count lines in a simple file', () => {
      const content = 'line1\nline2\nline3';
      expect(countLinesForNewFile(content)).toBe(3);
    });

    it('should handle file ending with newline', () => {
      const content = 'line1\nline2\nline3\n';
      expect(countLinesForNewFile(content)).toBe(3);
    });

    it('should handle single line file without newline', () => {
      const content = 'single line';
      expect(countLinesForNewFile(content)).toBe(1);
    });

    it('should handle single line file with newline', () => {
      const content = 'single line\n';
      expect(countLinesForNewFile(content)).toBe(1);
    });

    it('should handle empty string', () => {
      expect(countLinesForNewFile('')).toBe(0);
    });

    it('should handle file with only newline', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const content = '\n';
      // Split gives ['', ''], length 2, ends with \n so subtract 1 = 1
      // Actually '' ends with '\n' is true, so 2 - 1 = 1
      expect(countLinesForNewFile('\n')).toBe(1);
    });

    it('should handle multi-line file with real content', () => {
      const content = `<script>
  let count = 0;
</script>

<button on:click={() => count++}>
  Clicked {count} times
</button>
`;
      // 8 lines with trailing newline = 7 actual lines
      expect(countLinesForNewFile(content)).toBe(7);
    });
  });
});

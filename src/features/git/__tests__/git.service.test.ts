/**
 * Tests for GitService
 * Verifies git status parsing, particularly filename extraction
 */

import { describe, it, expect } from 'vitest';
import { GitService } from '../main/git.service';

describe('GitService', () => {
  const gitService = new GitService();

  describe('parseStatusOutput', () => {
    it('should correctly parse standard git status format with leading space', () => {
      const output = ' M jsconfig.json\n';
      // Access private method through type casting for testing
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('jsconfig.json');
      expect(result[0].status).toBe('M');
      // The main bug we're fixing is that the filename was being truncated
      // The staged status logic is a separate concern
      // Just verify the path is correct
    });

    it('should correctly parse git status format with staged modification', () => {
      const output = 'M  package.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('package.json');
      expect(result[0].status).toBe('M');
      expect(result[0].staged).toBe(true); // M in index = staged
    });

    it('should correctly parse git status format with both staged and unstaged changes', () => {
      const output = 'MM tsconfig.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      // Files with both staged and unstaged changes should create TWO entries
      expect(result).toHaveLength(2);

      // First entry: staged changes
      expect(result[0].path).toBe('tsconfig.json');
      expect(result[0].status).toBe('M'); // M from index
      expect(result[0].staged).toBe(true);

      // Second entry: unstaged changes
      expect(result[1].path).toBe('tsconfig.json');
      expect(result[1].status).toBe('M'); // M from work tree
      expect(result[1].staged).toBe(false);
    });

    it('should correctly parse added files', () => {
      const output = 'A  newfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('newfile.ts');
      expect(result[0].status).toBe('A');
    });

    it('should correctly parse deleted files', () => {
      const output = ' D oldfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('oldfile.ts');
      expect(result[0].status).toBe('D');
    });

    it('should correctly parse untracked files', () => {
      const output = '?? untrackedfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('untrackedfile.ts');
      expect(result[0].status).toBe('?');
    });

    it('should correctly parse untracked files in subdirectories (with --untracked-files=all)', () => {
      // When using git status --porcelain --untracked-files=all,
      // Git lists individual files instead of directories with trailing slash
      const output = '?? src/stores/theme.ts\n?? src/stores/user.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('src/stores/theme.ts');
      expect(result[0].status).toBe('?');
      expect(result[1].path).toBe('src/stores/user.ts');
      expect(result[1].status).toBe('?');
    });

    it('should handle multiple files', () => {
      const output = ' M jsconfig.json\nM  package.json\nA  newfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(3);
      expect(result[0].path).toBe('jsconfig.json');
      expect(result[1].path).toBe('package.json');
      expect(result[2].path).toBe('newfile.ts');
    });

    it('should handle files with paths containing slashes', () => {
      const output = ' M src/components/Button.svelte\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/components/Button.svelte');
    });

    it('should skip invalid lines', () => {
      const output = ' M jsconfig.json\n\n  \nM  package.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('jsconfig.json');
      expect(result[1].path).toBe('package.json');
    });

    it('should not truncate first character of filename', () => {
      // This is the bug we're fixing - jsconfig.json was being displayed as sconfig.json
      const output = ' M jsconfig.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result[0].path).not.toBe('sconfig.json');
      expect(result[0].path).toBe('jsconfig.json');
    });

    it('should correctly identify staged files (README.md case from bug report)', () => {
      // This is the exact case from the bug report
      // After staging, git status shows "M  README.md" (M in index, space in work tree)
      const output = 'M  README.md\n M jsconfig.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('README.md');
      expect(result[0].staged).toBe(true); // M in index = staged
      expect(result[1].path).toBe('jsconfig.json');
      expect(result[1].staged).toBe(false); // space in index = not staged
    });

    it('should correctly parse unstaged modification', () => {
      // " M" means space in index (not staged), M in work tree (modified)
      // Note: the output string must include the leading space
      const output = ' M unstaged.js\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('unstaged.js');
      expect(result[0].status).toBe('M');
      expect(result[0].staged).toBe(false);
    });

    it('should handle AM status (added and modified)', () => {
      // "AM" means A in index (staged addition), M in work tree (modified)
      const output = 'AM newfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(2);

      // First entry: staged addition
      expect(result[0].path).toBe('newfile.ts');
      expect(result[0].status).toBe('A');
      expect(result[0].staged).toBe(true);

      // Second entry: unstaged modification
      expect(result[1].path).toBe('newfile.ts');
      expect(result[1].status).toBe('M');
      expect(result[1].staged).toBe(false);
    });

    it('should handle AD status (added and deleted)', () => {
      // "AD" means A in index (staged addition), D in work tree (deleted)
      const output = 'AD deletedfile.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(2);

      // First entry: staged addition
      expect(result[0].path).toBe('deletedfile.ts');
      expect(result[0].status).toBe('A');
      expect(result[0].staged).toBe(true);

      // Second entry: unstaged deletion
      expect(result[1].path).toBe('deletedfile.ts');
      expect(result[1].status).toBe('D');
      expect(result[1].staged).toBe(false);
    });

    it('should handle multiple files with mixed statuses', () => {
      const output = 'MM file1.ts\n M file2.ts\nM  file3.ts\n';
      const result = (gitService as any).parseStatusOutput(output);

      // file1.ts (MM) -> 2 entries, file2.ts ( M) -> 1 entry, file3.ts (M ) -> 1 entry
      expect(result).toHaveLength(4);

      // file1.ts staged
      expect(result[0].path).toBe('file1.ts');
      expect(result[0].staged).toBe(true);

      // file1.ts unstaged
      expect(result[1].path).toBe('file1.ts');
      expect(result[1].staged).toBe(false);

      // file2.ts unstaged
      expect(result[2].path).toBe('file2.ts');
      expect(result[2].staged).toBe(false);

      // file3.ts staged
      expect(result[3].path).toBe('file3.ts');
      expect(result[3].staged).toBe(true);
    });

    it('should NOT filter out .augment/ files (git is the source of truth for ignore rules)', () => {
      // If git status reports .augment/ files, it means they are NOT gitignored
      // (e.g., the user's .gitignore has negation patterns like !.augment/skills/)
      // The app should trust git and show these files.
      const output = '?? .augment/skills/cognitive-complexity/README.md\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('.augment/skills/cognitive-complexity/README.md');
      expect(result[0].status).toBe('?');
    });

    it('should show .augment/ files alongside regular files', () => {
      const output =
        ' M src/app.ts\n?? .augment/skills/cognitive-complexity/index.ts\nM  package.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(3);
      expect(result[0].path).toBe('src/app.ts');
      expect(result[1].path).toBe('.augment/skills/cognitive-complexity/index.ts');
      expect(result[1].status).toBe('?');
      expect(result[2].path).toBe('package.json');
    });

    it('should handle staged .augment/ files', () => {
      const output = 'A  .augment/skills/my-skill/config.json\n';
      const result = (gitService as any).parseStatusOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('.augment/skills/my-skill/config.json');
      expect(result[0].status).toBe('A');
      expect(result[0].staged).toBe(true);
    });
  });
});

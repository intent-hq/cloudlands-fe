/**
 * Tests for Git Scope Validation
 * Verifies that file staging operations respect workspace scope boundaries
 */

import { describe, it, expect } from 'vitest';
import { validatePathsInScope } from '../main/git-router';

describe('validatePathsInScope', () => {
  const worktreePath = '/repo';

  describe('without scope', () => {
    it('should allow all paths when scope is undefined', () => {
      const result = validatePathsInScope(['src/file.ts', 'docs/readme.md'], undefined, worktreePath);
      expect(result).toBeNull();
    });

    it('should allow all paths when scope is empty string', () => {
      const result = validatePathsInScope(['src/file.ts', 'docs/readme.md'], '', worktreePath);
      expect(result).toBeNull();
    });
  });

  describe('with scope', () => {
    it('should allow files within scope', () => {
      const result = validatePathsInScope(['apps/web/src/main.ts', 'apps/web/package.json'], 'apps/web', worktreePath);
      expect(result).toBeNull();
    });

    it('should reject files outside scope', () => {
      const result = validatePathsInScope(['src/file.ts'], 'apps/web', worktreePath);
      expect(result).not.toBeNull();
      expect(result).toContain('outside the workspace scope');
    });

    it('should reject mixed paths with some outside scope', () => {
      const result = validatePathsInScope(
        ['apps/web/src/main.ts', 'src/other.ts'],
        'apps/web',
        worktreePath,
      );
      expect(result).not.toBeNull();
      expect(result).toContain('outside the workspace scope');
    });

    it('should handle relative paths with ..', () => {
      const result = validatePathsInScope(['apps/web/../other/file.ts'], 'apps/web', worktreePath);
      expect(result).not.toBeNull();
    });

    it('should handle absolute paths', () => {
      const result = validatePathsInScope(['/repo/apps/web/src/main.ts'], 'apps/web', worktreePath);
      expect(result).toBeNull();
    });

    it('should reject absolute paths outside scope', () => {
      const result = validatePathsInScope(['/repo/src/file.ts'], 'apps/web', worktreePath);
      expect(result).not.toBeNull();
    });

    it('should handle nested scopes', () => {
      const result = validatePathsInScope(
        ['apps/web/src/components/Button.ts'],
        'apps/web',
        worktreePath,
      );
      expect(result).toBeNull();
    });

    it('should reject files in sibling directories', () => {
      const result = validatePathsInScope(['apps/api/src/main.ts'], 'apps/web', worktreePath);
      expect(result).not.toBeNull();
    });

    it('should handle scope with trailing slash', () => {
      const result = validatePathsInScope(['apps/web/src/main.ts'], 'apps/web/', worktreePath);
      expect(result).toBeNull();
    });

    it('should handle multiple files all within scope', () => {
      const result = validatePathsInScope(
        ['apps/web/src/main.ts', 'apps/web/src/utils.ts', 'apps/web/package.json'],
        'apps/web',
        worktreePath,
      );
      expect(result).toBeNull();
    });

    it('should provide clear error message with file path and scope', () => {
      const result = validatePathsInScope(['src/file.ts'], 'apps/web', worktreePath);
      expect(result).toContain('src/file.ts');
      expect(result).toContain('apps/web');
    });
  });

  describe('edge cases', () => {
    it('should handle empty file paths array', () => {
      const result = validatePathsInScope([], 'apps/web', worktreePath);
      expect(result).toBeNull();
    });

    it('should handle scope at root level', () => {
      const result = validatePathsInScope(['file.ts'], '.', worktreePath);
      expect(result).toBeNull();
    });

    it('should handle deeply nested scopes', () => {
      const result = validatePathsInScope(
        ['a/b/c/d/e/file.ts'],
        'a/b/c/d/e',
        worktreePath,
      );
      expect(result).toBeNull();
    });

    it('should reject files in parent directory of scope', () => {
      const result = validatePathsInScope(['apps/file.ts'], 'apps/web', worktreePath);
      expect(result).not.toBeNull();
    });
  });
});

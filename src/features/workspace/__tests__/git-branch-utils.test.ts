/**
 * Tests for git branch parsing utilities.
 *
 * These tests ensure we correctly parse git branch output in all its variations,
 * including edge cases like worktree branches (+ prefix) and HEAD references.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  parseBranchName,
  parseRemoteBranchName,
  escapeRegExp,
  createSlugPattern,
  createSuffixCapturePattern,
} from '../main/git-branch-utils';

describe('git-branch-utils', () => {
  describe('parseBranchName', () => {
    it('should parse regular branch with leading spaces', () => {
      expect(parseBranchName('  main')).toBe('main');
      expect(parseBranchName('  feature-branch')).toBe('feature-branch');
    });

    it('should parse current branch with asterisk prefix', () => {
      expect(parseBranchName('* main')).toBe('main');
      expect(parseBranchName('* feature-branch')).toBe('feature-branch');
    });

    it('should parse worktree branch with plus prefix', () => {
      // This was the bug that caused the workspace creation failure!
      expect(parseBranchName('+ dark-add-54')).toBe('dark-add-54');
      expect(parseBranchName('+ feature-branch')).toBe('feature-branch');
    });

    it('should handle mixed prefixes', () => {
      expect(parseBranchName('  * main')).toBe('main');
      expect(parseBranchName(' + main')).toBe('main');
      expect(parseBranchName('*+ main')).toBe('main');
    });

    it('should handle empty and whitespace-only lines', () => {
      expect(parseBranchName('')).toBe('');
      expect(parseBranchName('   ')).toBe('');
      expect(parseBranchName('\t')).toBe('');
    });

    it('should preserve branch names with special characters', () => {
      expect(parseBranchName('  feature/test')).toBe('feature/test');
      expect(parseBranchName('  fix-bug-123')).toBe('fix-bug-123');
      expect(parseBranchName('  user@feature')).toBe('user@feature');
    });
  });

  describe('parseRemoteBranchName', () => {
    const remotePrefix = 'origin/';

    it('should parse regular remote branch', () => {
      expect(parseRemoteBranchName('  origin/main', remotePrefix)).toBe('main');
      expect(parseRemoteBranchName('  origin/feature-branch', remotePrefix)).toBe('feature-branch');
    });

    it('should skip HEAD references', () => {
      expect(parseRemoteBranchName('  origin/HEAD -> origin/main', remotePrefix)).toBeNull();
    });

    it('should skip branches from other remotes', () => {
      expect(parseRemoteBranchName('  upstream/main', remotePrefix)).toBeNull();
      expect(parseRemoteBranchName('  fork/feature', remotePrefix)).toBeNull();
    });

    it('should handle empty lines', () => {
      expect(parseRemoteBranchName('', remotePrefix)).toBeNull();
      expect(parseRemoteBranchName('   ', remotePrefix)).toBeNull();
    });

    it('should work with different remote prefixes', () => {
      expect(parseRemoteBranchName('  upstream/main', 'upstream/')).toBe('main');
      expect(parseRemoteBranchName('  fork/feature', 'fork/')).toBe('feature');
    });
  });

  describe('escapeRegExp', () => {
    it('should not modify safe strings', () => {
      expect(escapeRegExp('auth-fix')).toBe('auth-fix');
      expect(escapeRegExp('simple')).toBe('simple');
      expect(escapeRegExp('with-hyphens')).toBe('with-hyphens');
    });

    it('should escape dots', () => {
      expect(escapeRegExp('test.branch')).toBe('test\\.branch');
    });

    it('should escape brackets', () => {
      expect(escapeRegExp('feature[1]')).toBe('feature\\[1\\]');
    });

    it('should escape all special regex characters', () => {
      expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });
  });

  describe('createSlugPattern', () => {
    it('should match exact base slug', () => {
      const pattern = createSlugPattern('auth-fix');
      expect(pattern.test('auth-fix')).toBe(true);
    });

    it('should match base slug with numeric suffix', () => {
      const pattern = createSlugPattern('auth-fix');
      expect(pattern.test('auth-fix-2')).toBe(true);
      expect(pattern.test('auth-fix-42')).toBe(true);
      expect(pattern.test('auth-fix-123')).toBe(true);
    });

    it('should not match extended names', () => {
      const pattern = createSlugPattern('auth-fix');
      expect(pattern.test('auth-fixer')).toBe(false);
      expect(pattern.test('auth-fix-feature')).toBe(false);
      expect(pattern.test('auth-fix-2-extra')).toBe(false);
    });

    it('should handle slugs with special regex characters', () => {
      // Defensive test - slugs shouldn't have these, but the code should handle them
      const pattern = createSlugPattern('test.branch');
      expect(pattern.test('test.branch')).toBe(true);
      expect(pattern.test('testXbranch')).toBe(false); // dot should not match any char
    });
  });

  describe('createSuffixCapturePattern', () => {
    it('should capture numeric suffix', () => {
      const pattern = createSuffixCapturePattern('auth-fix');
      expect('auth-fix-42'.match(pattern)?.[1]).toBe('42');
      expect('auth-fix-123'.match(pattern)?.[1]).toBe('123');
    });

    it('should not match base slug without suffix', () => {
      const pattern = createSuffixCapturePattern('auth-fix');
      expect('auth-fix'.match(pattern)).toBeNull();
    });

    it('should not match non-numeric suffixes', () => {
      const pattern = createSuffixCapturePattern('auth-fix');
      expect('auth-fix-feature'.match(pattern)).toBeNull();
    });
  });
});

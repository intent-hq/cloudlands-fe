/**
 * Tests for git-tracking types and Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  GitFileStatus,
  ChangeLocation,
  GitFileChangeSchema,
  GitCommitSchema,
  type GitFileChange,
  type GitCommit,
  type GitBranch,
  type PullRequest,
  type GitState,
} from '../types';

describe('git-tracking types', () => {
  describe('GitFileStatus enum', () => {
    it('should have all expected status values', () => {
      expect(GitFileStatus.Added).toBe('added');
      expect(GitFileStatus.Modified).toBe('modified');
      expect(GitFileStatus.Deleted).toBe('deleted');
      expect(GitFileStatus.Renamed).toBe('renamed');
      expect(GitFileStatus.Copied).toBe('copied');
      expect(GitFileStatus.Untracked).toBe('untracked');
      expect(GitFileStatus.Ignored).toBe('ignored');
      expect(GitFileStatus.Conflicted).toBe('conflicted');
    });
  });

  describe('ChangeLocation enum', () => {
    it('should have all expected location values', () => {
      expect(ChangeLocation.WorkingDirectory).toBe('working');
      expect(ChangeLocation.StagingArea).toBe('staged');
      expect(ChangeLocation.LocalCommit).toBe('committed');
      expect(ChangeLocation.RemoteBranch).toBe('remote');
      expect(ChangeLocation.PullRequest).toBe('pr');
      expect(ChangeLocation.Merged).toBe('merged');
    });
  });

  describe('GitFileChangeSchema', () => {
    it('should validate a valid file change', () => {
      const change: GitFileChange = {
        path: '/path/to/file.ts',
        relativePath: 'file.ts',
        status: GitFileStatus.Modified,
        location: ChangeLocation.WorkingDirectory,
        additions: 10,
        deletions: 5,
      };

      const result = GitFileChangeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });

    it('should validate a renamed file', () => {
      const change: GitFileChange = {
        path: '/path/to/new-file.ts',
        relativePath: 'new-file.ts',
        status: GitFileStatus.Renamed,
        location: ChangeLocation.StagingArea,
        oldPath: 'old-file.ts',
        similarity: 95,
      };

      const result = GitFileChangeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const change = {
        path: '/path/to/file.ts',
        relativePath: 'file.ts',
        status: 'invalid-status',
        location: ChangeLocation.WorkingDirectory,
      };

      const result = GitFileChangeSchema.safeParse(change);
      expect(result.success).toBe(false);
    });
  });

  describe('GitCommitSchema', () => {
    it('should validate a valid commit', () => {
      const commit: GitCommit = {
        sha: 'abc123def456',
        shortSha: 'abc123d',
        author: {
          name: 'Test User',
          email: 'test@example.com',
          date: '2025-12-13T10:00:00Z',
        },
        committer: {
          name: 'Test User',
          email: 'test@example.com',
          date: '2025-12-13T10:00:00Z',
        },
        message: 'Test commit\n\nThis is the body',
        subject: 'Test commit',
        body: 'This is the body',
        parents: ['parent123'],
        files: [],
        stats: {
          additions: 10,
          deletions: 5,
          filesChanged: 2,
        },
      };

      const result = GitCommitSchema.safeParse(commit);
      expect(result.success).toBe(true);
    });
  });

  describe('Type structures', () => {
    it('should create valid GitBranch', () => {
      const branch: GitBranch = {
        name: 'feature/test',
        current: true,
        remote: 'origin',
        upstream: 'origin/feature/test',
        ahead: 2,
        behind: 0,
        protected: false,
      };

      expect(branch.name).toBe('feature/test');
      expect(branch.current).toBe(true);
    });

    it('should create valid PullRequest', () => {
      const pr: PullRequest = {
        id: 'pr-123',
        number: 123,
        title: 'Test PR',
        state: 'open',
        url: 'https://api.github.com/repos/owner/repo/pulls/123',
        htmlUrl: 'https://github.com/owner/repo/pull/123',
        sourceBranch: 'feature/test',
        targetBranch: 'main',
        author: {
          login: 'testuser',
          name: 'Test User',
        },
        createdAt: '2025-12-13T10:00:00Z',
        updatedAt: '2025-12-13T10:00:00Z',
        reviews: [],
        checks: [],
        labels: ['enhancement'],
        assignees: ['testuser'],
        commits: 3,
        additions: 100,
        deletions: 50,
        changedFiles: 5,
      };

      expect(pr.number).toBe(123);
      expect(pr.state).toBe('open');
    });
  });
});

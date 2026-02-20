/**
 * Tests for workspace utilities
 */

import { describe, it, expect } from 'vitest';
import {
  getWorkspaceStage,
  getStageLabel,
  getStageDescription,
  type WorkspaceStage,
} from '../workspace-utils';
import { PullRequestStatus } from '$shared/types';
import type { Workspace } from '$shared/types';

describe('workspace-utils', () => {
  const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace =>
    ({
      id: 'test-workspace',
      name: 'Test Workspace',
      path: '/test/path',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }) as Workspace;

  describe('getWorkspaceStage', () => {
    it('should return "merged" when PR is merged', () => {
      const workspace = createWorkspace({
        activePullRequest: {
          id: 'pr-1',
          number: 1,
          title: 'Test PR',
          status: PullRequestStatus.Merged,
          url: 'https://github.com/test/pr/1',
        },
      });
      expect(getWorkspaceStage(workspace)).toBe('merged');
    });

    it('should return "pr-open" when PR is open', () => {
      const workspace = createWorkspace({
        activePullRequest: {
          id: 'pr-1',
          number: 1,
          title: 'Test PR',
          status: PullRequestStatus.Open,
          url: 'https://github.com/test/pr/1',
        },
      });
      expect(getWorkspaceStage(workspace)).toBe('pr-open');
    });

    it('should return "pr-open" when PR is draft', () => {
      const workspace = createWorkspace({
        pullRequests: [
          {
            id: 'pr-1',
            number: 1,
            title: 'Test PR',
            status: PullRequestStatus.Draft,
            url: 'https://github.com/test/pr/1',
          },
        ],
      });
      expect(getWorkspaceStage(workspace)).toBe('pr-open');
    });

    it('should return "in-progress" when there are code changes', () => {
      const workspace = createWorkspace({
        diffSummary: {
          totalFiles: 5,
          additions: 100,
          deletions: 50,
        },
      });
      expect(getWorkspaceStage(workspace)).toBe('in-progress');
    });

    it('should return "planning" when no changes or PRs', () => {
      const workspace = createWorkspace();
      expect(getWorkspaceStage(workspace)).toBe('planning');
    });
  });

  describe('getStageLabel', () => {
    it('should return correct labels', () => {
      expect(getStageLabel('planning')).toBe('Planning');
      expect(getStageLabel('in-progress')).toBe('In Progress');
      expect(getStageLabel('pr-open')).toBe('PR Open');
      expect(getStageLabel('merged')).toBe('Merged');
    });

    it('should return "Unknown" for invalid stage', () => {
      expect(getStageLabel('invalid' as WorkspaceStage)).toBe('Unknown');
    });
  });

  describe('getStageDescription', () => {
    it('should return correct descriptions', () => {
      expect(getStageDescription('planning')).toContain('planning');
      expect(getStageDescription('in-progress')).toContain('code changes');
      expect(getStageDescription('pr-open')).toContain('review');
      expect(getStageDescription('merged')).toContain('merged');
    });

    it('should return empty string for invalid stage', () => {
      expect(getStageDescription('invalid' as WorkspaceStage)).toBe('');
    });
  });
});

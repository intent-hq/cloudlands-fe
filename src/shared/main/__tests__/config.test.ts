/**
 * Tests for WorkspaceConfig dual-root resolution
 *
 * Verifies that workspace paths resolve correctly for both
 * ~/intent (new) and ~/.workspaces (legacy) roots.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
const { mockExistsSync, toOsPath } = vi.hoisted(() => {
  const pathModule = require('path');
  return {
    mockExistsSync: vi.fn<(p: string | Buffer) => boolean>(() => false),
    toOsPath: (p: string): string => p.split('/').join(pathModule.sep),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: mockExistsSync,
  };
});

// Mock getSafeHomeDir to return a predictable path
vi.mock('../utils', () => ({
  getSafeHomeDir: () => toOsPath('/Users/testuser'),
  getWorkspacesPath: () => toOsPath('/Users/testuser/intent'),
  isValidDirectory: () => true,
}));

import { WorkspaceConfig } from '../config';

describe('WorkspaceConfig', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    // Reset env vars
    delete process.env.WORKSPACES_BASE_DIR;
    delete process.env.AUGMENT_WORKSPACES_ROOT;
  });

  afterEach(() => {
    delete process.env.WORKSPACES_BASE_DIR;
    delete process.env.AUGMENT_WORKSPACES_ROOT;
  });

  describe('WORKSPACE_ROOT', () => {
    it('should default to ~/intent', () => {
      expect(WorkspaceConfig.WORKSPACE_ROOT).toBe(toOsPath('/Users/testuser/intent'));
    });

    it('should respect WORKSPACES_BASE_DIR env override', () => {
      process.env.WORKSPACES_BASE_DIR = '/custom/path';
      expect(WorkspaceConfig.WORKSPACE_ROOT).toBe('/custom/path');
    });

    it('should respect AUGMENT_WORKSPACES_ROOT env override', () => {
      process.env.AUGMENT_WORKSPACES_ROOT = '/another/path';
      expect(WorkspaceConfig.WORKSPACE_ROOT).toBe('/another/path');
    });

    it('should ignore empty env overrides', () => {
      process.env.WORKSPACES_BASE_DIR = '   ';
      expect(WorkspaceConfig.WORKSPACE_ROOT).toBe(toOsPath('/Users/testuser/intent'));
    });
  });

  describe('LEGACY_WORKSPACE_ROOT', () => {
    it('should return ~/.workspaces', () => {
      expect(WorkspaceConfig.LEGACY_WORKSPACE_ROOT).toBe(toOsPath('/Users/testuser/.workspaces'));
    });
  });

  describe('resolveWorkspaceRoot', () => {
    it('should return WORKSPACES_BASE when workspace exists in ~/intent/workspaces/', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/intent/workspaces/my-workspace');
      });

      const root = WorkspaceConfig.resolveWorkspaceRoot('my-workspace');
      expect(root).toBe(toOsPath('/Users/testuser/intent/workspaces'));
    });

    it('should return WORKSPACE_ROOT when workspace exists in ~/intent/ (older location)', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/intent/my-workspace');
      });

      const root = WorkspaceConfig.resolveWorkspaceRoot('my-workspace');
      expect(root).toBe(toOsPath('/Users/testuser/intent'));
    });

    it('should return LEGACY_WORKSPACE_ROOT when workspace exists only in legacy location', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/.workspaces/old-workspace');
      });

      const root = WorkspaceConfig.resolveWorkspaceRoot('old-workspace');
      expect(root).toBe(toOsPath('/Users/testuser/.workspaces'));
    });

    it('should prefer ~/intent/workspaces/ when workspace exists in multiple locations', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return (
          p === toOsPath('/Users/testuser/intent/workspaces/dual-workspace') ||
          p === toOsPath('/Users/testuser/intent/dual-workspace') ||
          p === toOsPath('/Users/testuser/.workspaces/dual-workspace')
        );
      });

      const root = WorkspaceConfig.resolveWorkspaceRoot('dual-workspace');
      expect(root).toBe(toOsPath('/Users/testuser/intent/workspaces'));
    });

    it('should default to WORKSPACES_BASE for new/non-existent workspaces', () => {
      mockExistsSync.mockReturnValue(false);

      const root = WorkspaceConfig.resolveWorkspaceRoot('brand-new');
      expect(root).toBe(toOsPath('/Users/testuser/intent/workspaces'));
    });
  });

  describe('paths.workspace', () => {
    it('should resolve to ~/intent/workspaces/ for new workspaces', () => {
      mockExistsSync.mockReturnValue(false);

      expect(WorkspaceConfig.paths.workspace('ws-new')).toBe(
        toOsPath('/Users/testuser/intent/workspaces/ws-new'),
      );
    });

    it('should resolve to ~/intent/ for workspace that exists there', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/intent/ws-1');
      });

      expect(WorkspaceConfig.paths.workspace('ws-1')).toBe(toOsPath('/Users/testuser/intent/ws-1'));
    });

    it('should resolve to legacy root for workspace in ~/.workspaces', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/.workspaces/ws-legacy');
      });

      expect(WorkspaceConfig.paths.workspace('ws-legacy')).toBe(
        toOsPath('/Users/testuser/.workspaces/ws-legacy'),
      );
    });
  });

  describe('paths.metadata', () => {
    it('should resolve to ~/intent/workspaces/ for new workspaces', () => {
      mockExistsSync.mockReturnValue(false);

      expect(WorkspaceConfig.paths.metadata('ws-new')).toBe(
        toOsPath('/Users/testuser/intent/workspaces/ws-new/.workspace'),
      );
    });

    it('should resolve to ~/intent/ for workspace that exists there', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/intent/ws-1');
      });

      expect(WorkspaceConfig.paths.metadata('ws-1')).toBe(toOsPath('/Users/testuser/intent/ws-1/.workspace'));
    });

    it('should resolve legacy workspace metadata correctly', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/.workspaces/ws-old');
      });

      expect(WorkspaceConfig.paths.metadata('ws-old')).toBe(
        toOsPath('/Users/testuser/.workspaces/ws-old/.workspace'),
      );
    });
  });

  describe('paths — derived folders', () => {
    beforeEach(() => {
      // Workspace exists in new root
      mockExistsSync.mockImplementation((p: any) => {
        return String(p).startsWith(toOsPath('/Users/testuser/intent/ws-1'));
      });
    });

    it('paths.agents should resolve under .workspace/agents', () => {
      expect(WorkspaceConfig.paths.agents('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/agents'),
      );
    });

    it('paths.notes should resolve under .workspace/notes', () => {
      expect(WorkspaceConfig.paths.notes('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/notes'),
      );
    });

    it('paths.diffs should resolve under .workspace/diffs', () => {
      expect(WorkspaceConfig.paths.diffs('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/diffs'),
      );
    });

    it('paths.cache should resolve under .workspace/cache', () => {
      expect(WorkspaceConfig.paths.cache('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/cache'),
      );
    });

    it('paths.assets should resolve under .workspace/assets', () => {
      expect(WorkspaceConfig.paths.assets('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/assets'),
      );
    });

    it('paths.firstVisitState should resolve to first-visit-state.json', () => {
      expect(WorkspaceConfig.paths.firstVisitState('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/first-visit-state.json'),
      );
    });

    it('paths.workspaceMetadata should resolve to workspace.json', () => {
      expect(WorkspaceConfig.paths.workspaceMetadata('ws-1')).toBe(
        toOsPath('/Users/testuser/intent/ws-1/.workspace/workspace.json'),
      );
    });

    it('all derived paths should use legacy root for legacy workspaces', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p).startsWith(toOsPath('/Users/testuser/.workspaces/ws-old'));
      });

      expect(WorkspaceConfig.paths.agents('ws-old')).toBe(
        toOsPath('/Users/testuser/.workspaces/ws-old/.workspace/agents'),
      );
      expect(WorkspaceConfig.paths.notes('ws-old')).toBe(
        toOsPath('/Users/testuser/.workspaces/ws-old/.workspace/notes'),
      );
      expect(WorkspaceConfig.paths.diffs('ws-old')).toBe(
        toOsPath('/Users/testuser/.workspaces/ws-old/.workspace/diffs'),
      );
    });
  });

  describe('paths.worktree', () => {
    it('should default to ~/intent/workspaces/{id}/{repo}', () => {
      mockExistsSync.mockReturnValue(false);

      const wt = WorkspaceConfig.paths.worktree('ws-1', 'my-repo');
      expect(wt).toBe(toOsPath('/Users/testuser/intent/workspaces/ws-1/my-repo'));
    });

    it('should use "repo" as fallback folder name when no repo name given', () => {
      mockExistsSync.mockReturnValue(false);

      const wt = WorkspaceConfig.paths.worktree('ws-new');
      expect(wt).toBe(toOsPath('/Users/testuser/intent/workspaces/ws-new/repo'));
    });

    it('should use customBase when provided', () => {
      mockExistsSync.mockReturnValue(false);

      const wt = WorkspaceConfig.paths.worktree('ws-1', 'my-repo', undefined, '/custom/worktrees');
      expect(wt).toBe(toOsPath('/custom/worktrees/ws-1/my-repo'));
    });

    it('should ignore empty customBase and use default', () => {
      mockExistsSync.mockReturnValue(false);

      const wt = WorkspaceConfig.paths.worktree('ws-1', 'my-repo', undefined, '');
      expect(wt).toBe(toOsPath('/Users/testuser/intent/workspaces/ws-1/my-repo'));
    });
  });

  describe('paths.legacyWorktree', () => {
    it('should resolve to ~/intent/{id}/{repo} for workspace in ~/intent/', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/intent/ws-1');
      });

      const wt = WorkspaceConfig.paths.legacyWorktree('ws-1', 'my-repo');
      expect(wt).toBe(toOsPath('/Users/testuser/intent/ws-1/my-repo'));
    });

    it('should resolve to ~/.workspaces/{id}/{repo} for legacy workspace', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return p === toOsPath('/Users/testuser/.workspaces/ws-old');
      });

      const wt = WorkspaceConfig.paths.legacyWorktree('ws-old', 'my-repo');
      expect(wt).toBe(toOsPath('/Users/testuser/.workspaces/ws-old/my-repo'));
    });
  });

  describe('extractWorkspaceId', () => {
    it('should extract ID from new-style path', () => {
      expect(WorkspaceConfig.extractWorkspaceId(toOsPath('/Users/testuser/intent/abc-123/notes'))).toBe(
        'abc-123',
      );
    });

    it('should extract ID from legacy-style path', () => {
      expect(
        WorkspaceConfig.extractWorkspaceId(toOsPath('/Users/testuser/.workspaces/abc-123/.workspace')),
      ).toBe('abc-123');
    });

    it('should prefer intent over .workspaces in ambiguous paths', () => {
      // intent appears first in the path
      expect(
        WorkspaceConfig.extractWorkspaceId(toOsPath('/Users/testuser/intent/ws-1/.workspaces/something')),
      ).toBe('ws-1');
    });

    it('should return null for paths without workspace root', () => {
      expect(WorkspaceConfig.extractWorkspaceId(toOsPath('/Users/testuser/projects/foo'))).toBeNull();
    });

    it('should return null when workspace root is the last segment', () => {
      expect(WorkspaceConfig.extractWorkspaceId(toOsPath('/Users/testuser/intent'))).toBeNull();
    });

    it('should extract ID from worktree path (skip WORKTREES_FOLDER)', () => {
      // Worktree paths: ~/intent/workspaces/{id}/{repo}
      expect(
        WorkspaceConfig.extractWorkspaceId(
          toOsPath('/Users/testuser/intent/workspaces/amber-forest/my-repo/src/file.ts'),
        ),
      ).toBe('amber-forest');
    });

    it('should extract ID from worktree path without trailing segments', () => {
      expect(
        WorkspaceConfig.extractWorkspaceId(
          toOsPath('/Users/testuser/intent/workspaces/amber-forest/my-repo'),
        ),
      ).toBe('amber-forest');
    });
  });

  describe('paths.base', () => {
    it('should return WORKSPACE_ROOT', () => {
      expect(WorkspaceConfig.paths.base).toBe(toOsPath('/Users/testuser/intent'));
    });
  });
});

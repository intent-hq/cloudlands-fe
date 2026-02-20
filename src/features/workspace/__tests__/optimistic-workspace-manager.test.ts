/**
 * Tests for OptimisticWorkspaceManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { optimisticWorkspaceManager } from '../optimistic-workspace-manager';
import type { Workspace } from '$shared/types';

describe('OptimisticWorkspaceManager', () => {
  beforeEach(() => {
    optimisticWorkspaceManager.clearAll();
  });

  describe('createOptimisticWorkspace', () => {
    it('should create an optimistic workspace and return temp ID', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test Workspace');
      expect(tempId).toMatch(/^optimistic-/);
    });

    it('should store the optimistic workspace', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test', '/path/to/repo');
      const workspace = optimisticWorkspaceManager.getOptimisticWorkspace(tempId);
      expect(workspace).toBeDefined();
      expect(workspace?.name).toBe('Test');
      expect(workspace?.repoPath).toBe('/path/to/repo');
      expect(workspace?.isOptimistic).toBe(true);
    });
  });

  describe('isOptimistic', () => {
    it('should return true for optimistic workspaces', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      expect(optimisticWorkspaceManager.isOptimistic(tempId)).toBe(true);
    });

    it('should return false for non-optimistic IDs', () => {
      expect(optimisticWorkspaceManager.isOptimistic('real-workspace-id')).toBe(false);
    });
  });

  describe('isOptimisticId', () => {
    it('should be an alias for isOptimistic', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      expect(optimisticWorkspaceManager.isOptimisticId(tempId)).toBe(true);
    });
  });

  describe('isPending', () => {
    it('should return true for pending creations', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      expect(optimisticWorkspaceManager.isPending(tempId)).toBe(true);
    });
  });

  describe('resolveOptimisticWorkspace', () => {
    it('should remove optimistic workspace on resolution', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      const realWorkspace = { id: 'real-id', name: 'Test' } as Workspace;

      optimisticWorkspaceManager.resolveOptimisticWorkspace(tempId, realWorkspace);

      expect(optimisticWorkspaceManager.isOptimistic(tempId)).toBe(false);
      expect(optimisticWorkspaceManager.isPending(tempId)).toBe(false);
    });

    it('should notify listeners on resolution', () => {
      const listener = vi.fn();
      optimisticWorkspaceManager.addListener(listener);

      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      const realWorkspace = { id: 'real-id', name: 'Test' } as Workspace;
      optimisticWorkspaceManager.resolveOptimisticWorkspace(tempId, realWorkspace);

      expect(listener).toHaveBeenCalledWith(tempId, 'resolved', realWorkspace, undefined);
    });
  });

  describe('failOptimisticWorkspace', () => {
    it('should remove optimistic workspace on failure', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      const error = new Error('Creation failed');

      optimisticWorkspaceManager.failOptimisticWorkspace(tempId, error);

      expect(optimisticWorkspaceManager.isOptimistic(tempId)).toBe(false);
    });

    it('should notify listeners on failure', () => {
      const listener = vi.fn();
      optimisticWorkspaceManager.addListener(listener);

      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      const error = new Error('Creation failed');
      optimisticWorkspaceManager.failOptimisticWorkspace(tempId, error);

      expect(listener).toHaveBeenCalledWith(tempId, 'failed', null, error);
    });
  });

  describe('removeOptimisticWorkspace', () => {
    it('should remove optimistic workspace', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      optimisticWorkspaceManager.removeOptimisticWorkspace(tempId);
      expect(optimisticWorkspaceManager.isOptimistic(tempId)).toBe(false);
    });
  });

  describe('getTransition', () => {
    it('should return transition data for optimistic workspace', () => {
      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test', '/path');
      const transition = optimisticWorkspaceManager.getTransition(tempId);
      expect(transition?.config?.title).toBe('Test');
      expect(transition?.config?.repositoryPath).toBe('/path');
    });

    it('should return null for non-optimistic workspace', () => {
      expect(optimisticWorkspaceManager.getTransition('unknown')).toBeNull();
    });
  });

  describe('getAllOptimisticWorkspaces', () => {
    it('should return all optimistic workspaces', () => {
      optimisticWorkspaceManager.createOptimisticWorkspace('Test1');
      optimisticWorkspaceManager.createOptimisticWorkspace('Test2');
      const all = optimisticWorkspaceManager.getAllOptimisticWorkspaces();
      expect(all).toHaveLength(2);
    });
  });

  describe('addListener', () => {
    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = optimisticWorkspaceManager.addListener(listener);

      const tempId = optimisticWorkspaceManager.createOptimisticWorkspace('Test');
      unsubscribe();
      optimisticWorkspaceManager.removeOptimisticWorkspace(tempId);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

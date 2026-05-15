/**
 * Tests for MockSessionRegistry
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { MockSessionRegistry } from '../session-registry.mock';

describe('MockSessionRegistry', () => {
  let registry: MockSessionRegistry;

  beforeEach(() => {
    registry = new MockSessionRegistry();
  });

  describe('Session Registration', () => {
    it('should register a session', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      const session = await registry.getSession('frontend-1');
      expect(session).toBeDefined();
      expect(session?.frontendId).toBe('frontend-1');
      expect(session?.backendId).toBe('backend-1');
      expect(session?.workspaceId).toBe('workspace-1');
      expect(session?.status).toBe('active');
    });

    it('should register with auggie process ID', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1', 'process-123');

      const session = await registry.getSession('frontend-1');
      expect(session?.auggieProcessId).toBe('process-123');
    });
  });

  describe('Session Retrieval', () => {
    it('should get a session', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      const session = await registry.getSession('frontend-1');
      expect(session).toBeDefined();
    });

    it('should return null for non-existent session', async () => {
      const session = await registry.getSession('non-existent');
      expect(session).toBeNull();
    });

    it('should get backend ID', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      const backendId = await registry.getBackendId('frontend-1');
      expect(backendId).toBe('backend-1');
    });

    it('should return null for non-existent backend ID', async () => {
      const backendId = await registry.getBackendId('non-existent');
      expect(backendId).toBeNull();
    });
  });

  describe('Status Updates', () => {
    it('should update session status', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      await registry.updateStatus('frontend-1', 'inactive');

      const session = await registry.getSession('frontend-1');
      expect(session?.status).toBe('inactive');
    });

    it('should update lastAccessed on status change', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      const before = (await registry.getSession('frontend-1'))?.lastAccessed;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await registry.updateStatus('frontend-1', 'disconnected');

      const after = (await registry.getSession('frontend-1'))?.lastAccessed;
      expect(after?.getTime()).toBeGreaterThan(before?.getTime() || 0);
    });
  });

  describe('Session Listing', () => {
    it('should list all sessions', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');
      await registry.registerSession('frontend-2', 'backend-2', 'workspace-2');

      const sessions = await registry.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should list sessions for a workspace', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');
      await registry.registerSession('frontend-2', 'backend-2', 'workspace-1');
      await registry.registerSession('frontend-3', 'backend-3', 'workspace-2');

      const sessions = await registry.listSessionsForWorkspace('workspace-1');
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.workspaceId === 'workspace-1')).toBe(true);
    });
  });

  describe('Session Deletion', () => {
    it('should delete a session', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      await registry.deleteSession('frontend-1');

      const session = await registry.getSession('frontend-1');
      expect(session).toBeNull();
    });
  });

  describe('Call Logging', () => {
    it('should log method calls', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');
      await registry.getSession('frontend-1');
      await registry.listSessions();

      const log = registry.getCallLog();
      expect(log.length).toBeGreaterThanOrEqual(3);
      expect(log[0].method).toBe('registerSession');
      expect(log[1].method).toBe('getSession');
      expect(log[2].method).toBe('listSessions');
    });
  });

  describe('Clear Operations', () => {
    it('should clear all data', async () => {
      await registry.registerSession('frontend-1', 'backend-1', 'workspace-1');

      registry.clear();

      const sessions = await registry.listSessions();
      expect(sessions).toHaveLength(0);
      // After clear, only the listSessions call should be in the log
      expect(registry.getCallLog()).toHaveLength(1);
      expect(registry.getCallLog()[0].method).toBe('listSessions');
    });
  });
});

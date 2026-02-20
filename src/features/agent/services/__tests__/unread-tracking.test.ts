import { describe, it, expect, beforeEach, vi } from 'vitest';
import { unreadTrackingService } from '../unread-tracking.service';

describe('UnreadTrackingService', () => {
  beforeEach(() => {
    // Clear all unread state between tests
    unreadTrackingService.clearAll();
  });

  describe('markAsViewed', () => {
    it('should track currently viewed agent', () => {
      unreadTrackingService.markAsViewed('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(false);
    });

    it('should clear unread status when viewing an agent', () => {
      // First mark as unread
      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(true);

      // Then view it
      unreadTrackingService.markAsViewed('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(false);
    });
  });

  describe('onNewAssistantMessage', () => {
    it('should mark agent as unread when not currently viewed', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(true);
    });

    it('should NOT mark agent as unread when currently viewing it', () => {
      unreadTrackingService.markAsViewed('agent-1');
      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(false);
    });

    it('should mark other agents as unread when viewing a different agent', () => {
      unreadTrackingService.markAsViewed('agent-1');
      unreadTrackingService.onNewAssistantMessage('agent-2');
      expect(unreadTrackingService.hasUnread('agent-2')).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('should return 0 when no unread agents', () => {
      expect(unreadTrackingService.getUnreadCount()).toBe(0);
    });

    it('should count unread agents correctly', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1');
      unreadTrackingService.onNewAssistantMessage('agent-2');
      unreadTrackingService.onNewAssistantMessage('agent-3');
      expect(unreadTrackingService.getUnreadCount()).toBe(3);
    });

    it('should decrease count when viewing agents', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1');
      unreadTrackingService.onNewAssistantMessage('agent-2');
      expect(unreadTrackingService.getUnreadCount()).toBe(2);

      unreadTrackingService.markAsViewed('agent-1');
      expect(unreadTrackingService.getUnreadCount()).toBe(1);
    });
  });

  describe('clearUnread', () => {
    it('should clear unread for specific agent', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1');
      unreadTrackingService.onNewAssistantMessage('agent-2');
      expect(unreadTrackingService.getUnreadCount()).toBe(2);

      unreadTrackingService.clearUnread('agent-1');
      expect(unreadTrackingService.getUnreadCount()).toBe(1);
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(false);
      expect(unreadTrackingService.hasUnread('agent-2')).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers when unread count changes', async () => {
      const callback = vi.fn();
      const unsubscribe = unreadTrackingService.subscribe(callback);

      // Initial state is deferred via queueMicrotask, so we need to wait
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(callback).toHaveBeenCalledWith(0);
      callback.mockClear();

      // Add unread
      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(callback).toHaveBeenCalledWith(1);

      // Add another
      unreadTrackingService.onNewAssistantMessage('agent-2');
      expect(callback).toHaveBeenCalledWith(2);

      // View one
      unreadTrackingService.markAsViewed('agent-1');
      expect(callback).toHaveBeenCalledWith(1);

      unsubscribe();
    });

    it('should allow unsubscribing', async () => {
      const callback = vi.fn();
      const unsubscribe = unreadTrackingService.subscribe(callback);

      // Wait for initial notification
      await new Promise((resolve) => queueMicrotask(resolve));
      callback.mockClear();

      unsubscribe();

      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clearCurrentlyViewed', () => {
    it('should clear currently viewed agent without affecting unread state', () => {
      unreadTrackingService.onNewAssistantMessage('agent-2');
      unreadTrackingService.markAsViewed('agent-1');

      // Viewing agent-1, agent-2 has unread
      expect(unreadTrackingService.hasUnread('agent-2')).toBe(true);

      unreadTrackingService.clearCurrentlyViewed();

      // Now new messages to agent-1 should be marked as unread
      unreadTrackingService.onNewAssistantMessage('agent-1');
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(true);
    });
  });

  describe('workspace tracking', () => {
    it('should track which workspace an unread agent belongs to', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1', 'workspace-a');
      unreadTrackingService.onNewAssistantMessage('agent-2', 'workspace-b');
      unreadTrackingService.onNewAssistantMessage('agent-3', 'workspace-a');

      expect(unreadTrackingService.getWorkspaceForAgent('agent-1')).toBe('workspace-a');
      expect(unreadTrackingService.getWorkspaceForAgent('agent-2')).toBe('workspace-b');
      expect(unreadTrackingService.getWorkspaceForAgent('agent-3')).toBe('workspace-a');
    });

    it('should return undefined for unknown agent', () => {
      expect(unreadTrackingService.getWorkspaceForAgent('unknown-agent')).toBeUndefined();
    });

    it('should return unread agents for a specific workspace', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1', 'workspace-a');
      unreadTrackingService.onNewAssistantMessage('agent-2', 'workspace-b');
      unreadTrackingService.onNewAssistantMessage('agent-3', 'workspace-a');
      unreadTrackingService.onNewAssistantMessage('agent-4'); // No workspace

      const workspaceAAgents = unreadTrackingService.getUnreadAgentIdsForWorkspace('workspace-a');
      expect(workspaceAAgents).toHaveLength(2);
      expect(workspaceAAgents).toContain('agent-1');
      expect(workspaceAAgents).toContain('agent-3');

      const workspaceBAgents = unreadTrackingService.getUnreadAgentIdsForWorkspace('workspace-b');
      expect(workspaceBAgents).toHaveLength(1);
      expect(workspaceBAgents).toContain('agent-2');

      const unknownWorkspaceAgents =
        unreadTrackingService.getUnreadAgentIdsForWorkspace('workspace-c');
      expect(unknownWorkspaceAgents).toHaveLength(0);
    });

    it('should clear workspace mapping when clearing unread', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1', 'workspace-a');
      expect(unreadTrackingService.getWorkspaceForAgent('agent-1')).toBe('workspace-a');

      unreadTrackingService.clearUnread('agent-1');
      expect(unreadTrackingService.getWorkspaceForAgent('agent-1')).toBeUndefined();
    });

    it('should clear all workspace mappings when clearing all', () => {
      unreadTrackingService.onNewAssistantMessage('agent-1', 'workspace-a');
      unreadTrackingService.onNewAssistantMessage('agent-2', 'workspace-b');

      unreadTrackingService.clearAll();

      expect(unreadTrackingService.getWorkspaceForAgent('agent-1')).toBeUndefined();
      expect(unreadTrackingService.getWorkspaceForAgent('agent-2')).toBeUndefined();
      expect(unreadTrackingService.getUnreadAgentIdsForWorkspace('workspace-a')).toHaveLength(0);
    });

    it('should update workspace mapping even if agent is currently viewed', () => {
      // View an agent first
      unreadTrackingService.markAsViewed('agent-1');

      // Send message with workspace - should store workspace even though agent won't be marked unread
      unreadTrackingService.onNewAssistantMessage('agent-1', 'workspace-a');

      // Agent should not be unread (since we're viewing it)
      expect(unreadTrackingService.hasUnread('agent-1')).toBe(false);

      // But workspace mapping should be stored for future use
      expect(unreadTrackingService.getWorkspaceForAgent('agent-1')).toBe('workspace-a');
    });
  });
});

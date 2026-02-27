/**
 * Integration tests for WorkspaceEventBus
 *
 * These tests verify:
 * 1. WorkspaceEventBus emits events correctly
 * 2. Events are forwarded to UnifiedEventBus for cross-workspace subscriptions
 * 3. No duplicate events are produced
 */

import { describe, it, expect, vi } from 'vitest';
import { getWorkspaceEventBus } from '../main/workspace-event-bus';
import { unifiedEventBus } from '../main/unified-event-bus';
import type { WorkspaceEvent } from '../types';

// Mock electron
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp/test'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    isReady: vi.fn(() => true),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

describe('WorkspaceEventBus Integration', () => {
  describe('event forwarding to UnifiedEventBus', () => {
    it('should forward events from WorkspaceEventBus to UnifiedEventBus', async () => {
      // Use unique workspace ID
      const workspaceId = `test-ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const bus = getWorkspaceEventBus(workspaceId);
      const unifiedListener = vi.fn();

      // Subscribe to UnifiedEventBus
      unifiedEventBus.on('agent:created', unifiedListener);

      try {
        // Emit event through WorkspaceEventBus
        const event: WorkspaceEvent = {
          id: 'test-event-1',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'agent:created',
          actor: { type: 'user', name: 'Test User' },
          data: { agentId: 'agent-1', agentName: 'Test Agent' },
        };

        bus.emitEvent(event);

        // Verify UnifiedEventBus received the event
        expect(unifiedListener).toHaveBeenCalledTimes(1);
        expect(unifiedListener).toHaveBeenCalledWith(event);
      } finally {
        // Clean up
        unifiedEventBus.off('agent:created', unifiedListener);
      }
    });
  });

  describe('no duplicate events', () => {
    it('should emit to both WorkspaceEventBus and UnifiedEventBus listeners', () => {
      // Use unique workspace ID
      const workspaceId = `test-ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const bus = getWorkspaceEventBus(workspaceId);
      const workspaceListener = vi.fn();
      const unifiedListener = vi.fn();

      // Subscribe to both buses with different listeners
      bus.on('agent:started', workspaceListener);
      unifiedEventBus.on('agent:started', unifiedListener);

      try {
        const event: WorkspaceEvent = {
          id: 'test-event-2',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'agent:started',
          actor: { type: 'agent', id: 'agent-1', name: 'Agent' },
          data: { agentId: 'agent-1', reason: 'message_received' },
        };

        bus.emitEvent(event);

        // Both listeners should receive the event
        expect(workspaceListener).toHaveBeenCalledTimes(1);
        expect(unifiedListener).toHaveBeenCalledTimes(1);
      } finally {
        // Clean up
        bus.off('agent:started', workspaceListener);
        unifiedEventBus.off('agent:started', unifiedListener);
      }
    });
  });
});

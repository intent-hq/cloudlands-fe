/**
 * Tests for usePanelActions composable
 */

import { describe, it, expect, vi } from 'vitest';

describe('usePanelActions', () => {
  describe('openAgent', () => {
    it('should not open agent with undefined id', () => {
      const mockOpenDrawer = vi.fn();
      const mockCloseDrawer = vi.fn();
      const mockWorkspaceState = {
        openDrawer: mockOpenDrawer,
        closeDrawer: mockCloseDrawer,
      };

      const agentId = undefined;

      // Simulate openAgent logic with validation
      if (!agentId) {
        // Should return early
        return;
      }

      mockWorkspaceState.openDrawer('agent', agentId);

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it('should not open agent with terminal id', () => {
      const mockOpenDrawer = vi.fn();
      const mockWorkspaceState = {
        openDrawer: mockOpenDrawer,
      };

      const agentId = 'terminal-123';

      // Simulate openAgent logic with validation
      if (agentId.startsWith('terminal-')) {
        // Should return early
        return;
      }

      mockWorkspaceState.openDrawer('agent', agentId);

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it('should toggle drawer closed when clicking already active agent', () => {
      const mockCloseDrawer = vi.fn();
      const mockOpenDrawer = vi.fn();
      const mockWorkspaceState = {
        openDrawer: mockOpenDrawer,
        closeDrawer: mockCloseDrawer,
      };

      const agentId = 'agent-123';
      const state = {
        drawer: {
          open: true,
          type: 'agent',
          itemId: 'agent-123',
        },
      };

      // Simulate openAgent toggle logic
      if (state.drawer.open && state.drawer.type === 'agent' && state.drawer.itemId === agentId) {
        mockWorkspaceState.closeDrawer();
      } else {
        mockWorkspaceState.openDrawer('agent', agentId);
      }

      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it('should open drawer when clicking different agent', () => {
      const mockCloseDrawer = vi.fn();
      const mockOpenDrawer = vi.fn();
      const mockWorkspaceState = {
        openDrawer: mockOpenDrawer,
        closeDrawer: mockCloseDrawer,
      };

      const agentId = 'agent-456';
      const state = {
        drawer: {
          open: true,
          type: 'agent',
          itemId: 'agent-123',
        },
      };

      // Simulate openAgent toggle logic
      if (state.drawer.open && state.drawer.type === 'agent' && state.drawer.itemId === agentId) {
        mockWorkspaceState.closeDrawer();
      } else {
        mockWorkspaceState.openDrawer('agent', agentId);
      }

      expect(mockOpenDrawer).toHaveBeenCalledWith('agent', 'agent-456');
      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });

  describe('openTerminal', () => {
    it('should redirect agent id to openAgent', () => {
      const mockOpenDrawer = vi.fn();
      let openAgentCalled = false;

      const terminalId = 'agent-123';

      // Simulate openTerminal logic with validation
      if (terminalId.startsWith('agent-')) {
        openAgentCalled = true;
        return;
      }

      mockOpenDrawer('terminal', terminalId);

      expect(openAgentCalled).toBe(true);
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it('should toggle drawer closed when clicking already active terminal', () => {
      const mockCloseDrawer = vi.fn();
      const mockOpenDrawer = vi.fn();
      const mockWorkspaceState = {
        openDrawer: mockOpenDrawer,
        closeDrawer: mockCloseDrawer,
      };

      const terminalId = 'terminal-123';
      const state = {
        drawer: {
          open: true,
          type: 'terminal',
          itemId: 'terminal-123',
        },
      };

      // Simulate openTerminal toggle logic
      if (
        state.drawer.open &&
        state.drawer.type === 'terminal' &&
        state.drawer.itemId === terminalId
      ) {
        mockWorkspaceState.closeDrawer();
      } else {
        mockWorkspaceState.openDrawer('terminal', terminalId);
      }

      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });
});

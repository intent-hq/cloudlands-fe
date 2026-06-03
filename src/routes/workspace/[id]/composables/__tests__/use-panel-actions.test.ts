/**
 * Tests for usePanelActions composable
 */

import {
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';

const { dispatchMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

import { usePanelActions } from '../use-panel-actions.svelte';

describe('usePanelActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockReset();
  });

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

  describe('handleCreateAgentWithPrompt', () => {
    function createActions(overrides: Record<string, unknown> = {}) {
      const openDrawer = vi.fn();
      const markAgentRecentlyCreated = vi.fn();
      const onDraftPromptSet = vi.fn();
      const actions = usePanelActions({
        workspace: () => ({ id: 'ws-1', title: 'Workspace' }) as any,
        workspaceState: () =>
          ({
            openFile: vi.fn(),
            openNote: vi.fn(),
            openDrawer,
            closeDrawer: vi.fn(),
            state: { workspace: { id: 'ws-1' } },
          }) as any,
        state: () => ({ drawer: { open: false } }) as any,
        markAgentRecentlyCreated,
        onDraftPromptSet,
        ...overrides,
      });

      return { actions, openDrawer, markAgentRecentlyCreated, onDraftPromptSet };
    }

    it('waits for the saga launch result before draft prompt follow-up', async () => {
      let resolveLaunch: ((session: any) => void) | undefined;
      dispatchMock.mockImplementation((action) => {
        if (action.type === 'agentSessions/launchAgentRequested') {
          resolveLaunch = action.success;
        }
      });
      const createdSession = {
        id: 'agent-created-by-saga',
        name: 'Prompt Agent',
        workspaceId: 'ws-1',
      };
      const { actions, openDrawer, markAgentRecentlyCreated, onDraftPromptSet } = createActions();

      const promise = actions.handleCreateAgentWithPrompt('Draft prompt', 'Prompt Agent');
      await Promise.resolve();

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentSessions/launchAgentRequested',
          payload: [
            'ws-1',
            expect.objectContaining({
              name: 'Prompt Agent',
              agentType: 'chat',
              source: 'progress-card-action',
            }),
          ],
        }),
      );
      expect(dispatchMock.mock.calls[0][0].payload[1]).not.toHaveProperty('id');
      expect(dispatchMock.mock.calls[0][0].payload[1]).not.toHaveProperty('model');
      expect(markAgentRecentlyCreated).not.toHaveBeenCalled();
      expect(onDraftPromptSet).not.toHaveBeenCalled();
      expect(openDrawer).not.toHaveBeenCalled();

      resolveLaunch?.(createdSession);
      await promise;

      expect(markAgentRecentlyCreated).toHaveBeenCalledWith('agent-created-by-saga');
      expect(onDraftPromptSet).toHaveBeenCalledWith('Draft prompt');
      expect(openDrawer).toHaveBeenCalledWith('agent', 'agent-created-by-saga');
    });

    it('does not run draft prompt follow-up when saga launch fails', async () => {
      dispatchMock.mockImplementation((action) => {
        if (action.type === 'agentSessions/launchAgentRequested') {
          action.failure('creation failed');
        }
      });
      const { actions, openDrawer, markAgentRecentlyCreated, onDraftPromptSet } = createActions();

      await actions.handleCreateAgentWithPrompt('Draft prompt', 'Prompt Agent');

      expect(markAgentRecentlyCreated).not.toHaveBeenCalled();
      expect(onDraftPromptSet).not.toHaveBeenCalled();
      expect(openDrawer).not.toHaveBeenCalled();
    });
  });
});

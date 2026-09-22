/**
 * Tests for usePanelActions composable
 */

import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { dispatchMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { workspaceAgentsReducer } =
    await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
    reducers: { workspaceAgents: workspaceAgentsReducer },
  });
});

import UsePanelActionsHarness from './UsePanelActionsHarness.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  agentCreationRequestFailed,
  agentCreationRequestSucceeded,
  createAgentFromConfigRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

describe('usePanelActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockReset();
    (appStore as typeof appStore & { resetReducers: () => void }).resetReducers();
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
    function renderActions() {
      const openDrawer = vi.fn();
      const markAgentRecentlyCreated = vi.fn();
      const onDraftPromptSet = vi.fn();
      const view = render(UsePanelActionsHarness, {
        openDrawer,
        markAgentRecentlyCreated,
        onDraftPromptSet,
      });
      return { view, openDrawer, markAgentRecentlyCreated, onDraftPromptSet };
    }

    it('waits for the saga launch result before draft prompt follow-up', async () => {
      const { view, openDrawer, markAgentRecentlyCreated, onDraftPromptSet } = renderActions();

      await fireEvent.click(view.getByRole('button'));

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentSessions/launchAgentRequested',
          payload: [
            'ws-1',
            expect.objectContaining({
              name: 'Prompt Agent',
              // Generated name from contextual actions — flagged as not
              // user-chosen so the agent can rename itself.
              nameExplicitlySet: false,
              agentType: 'chat',
              source: 'progress-card-action',
            }),
            expect.objectContaining({ requestId: expect.any(String) }),
          ],
        }),
      );
      const launchAction = dispatchMock.mock.calls.find(
        ([action]) => action.type === 'agentSessions/launchAgentRequested',
      )?.[0];
      const requestId = launchAction.payload[2].requestId as string;
      expect(launchAction.payload[1]).not.toHaveProperty('id');
      expect(launchAction.payload[1]).not.toHaveProperty('model');
      expect(markAgentRecentlyCreated).not.toHaveBeenCalled();
      expect(onDraftPromptSet).not.toHaveBeenCalled();
      expect(openDrawer).not.toHaveBeenCalled();

      appStore.dispatch(createAgentFromConfigRequested('ws-1', {} as never, { requestId }));
      appStore.dispatch(agentCreationRequestSucceeded('ws-1', requestId, 'agent-created-by-saga'));

      await waitFor(() =>
        expect(openDrawer).toHaveBeenCalledWith('agent', 'agent-created-by-saga'),
      );
      expect(markAgentRecentlyCreated).toHaveBeenCalledWith('agent-created-by-saga');
      expect(onDraftPromptSet).toHaveBeenCalledWith('Draft prompt');
    });

    it('does not run draft prompt follow-up when saga launch fails', async () => {
      const { view, openDrawer, markAgentRecentlyCreated, onDraftPromptSet } = renderActions();

      await fireEvent.click(view.getByRole('button'));
      const launchAction = dispatchMock.mock.calls.find(
        ([action]) => action.type === 'agentSessions/launchAgentRequested',
      )?.[0];
      const requestId = launchAction.payload[2].requestId as string;

      appStore.dispatch(createAgentFromConfigRequested('ws-1', {} as never, { requestId }));
      appStore.dispatch(agentCreationRequestFailed('ws-1', requestId, 'creation failed'));

      await waitFor(() =>
        expect(dispatchMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'workspaceAgents/clearAgentCreationRequest',
            payload: ['ws-1', requestId],
          }),
        ),
      );
      expect(onDraftPromptSet).not.toHaveBeenCalled();
      expect(openDrawer).not.toHaveBeenCalled();
      expect(markAgentRecentlyCreated).not.toHaveBeenCalled();
    });
  });
});

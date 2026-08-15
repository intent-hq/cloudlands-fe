/**
 * Unit tests for workspace navigation utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  navigateToAgent,
  navigateToNote,
  navigateToFile,
  navigateToTerminal,
  navigateToSpec,
  closeDrawer,
  clearMainContent,
  navigateAfterWorkspaceRemoval,
  navigateToFirstWorkspace,
} from './workspace-navigation';

const { mockDispatch, mockWorkspaceItems } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockWorkspaceItems: { value: [] as Array<{ id: string; status: string }> },
}));

// Mock svelte/store (SvelteKit mocks are in test-setup.ts)
vi.mock('svelte/store', () => ({
  get: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mockDispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: {
    select: () => mockWorkspaceItems.value,
  },
}));

// Import mocked modules
import { goto } from '$app/navigation';
import { get } from 'svelte/store';
import {
  closeWorkspaceDrawer,
  openWorkspaceDrawer,
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

describe('workspace-navigation', () => {
  const mockPage = {
    url: {
      pathname: '/workspace/test-workspace-id',
      searchParams: new URLSearchParams(),
    },
    params: {
      id: 'test-workspace-id',
    },
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset search params
    mockPage.url.searchParams = new URLSearchParams();
    mockWorkspaceItems.value = [];

    // Mock window.location.href - dynamically build from mockPage.url.searchParams
    Object.defineProperty(window, 'location', {
      value: {
        get href() {
          const params = mockPage.url.searchParams.toString();
          return `http://localhost:3000/workspace/test-workspace-id${params ? `?${params}` : ''}`;
        },
      },
      writable: true,
    });

    // Setup default mock return values
    (get as any).mockReturnValue(mockPage);
    (goto as any).mockResolvedValue(undefined);
    mockDispatch.mockReset();
  });

  describe('navigateToAgent', () => {
    it('should set drawer params for agent navigation', async () => {
      await navigateToAgent('agent-123');

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('drawerOpen=1');
      expect(callUrl).toContain('drawerType=agent');
      expect(callUrl).toContain('selectedAgent=agent-123');
      expect(goto).toHaveBeenCalledWith(expect.any(String), {
        replaceState: true,
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceDrawer('test-workspace-id', 'agent', 'agent-123'),
      );
    });

    it('should preserve existing URL params', async () => {
      mockPage.url.searchParams.set('selectedNoteId', 'note-456');

      await navigateToAgent('agent-123');

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('selectedNoteId=note-456');
    });

    it('should add to browser history', async () => {
      await navigateToAgent('agent-123');

      expect(goto).toHaveBeenCalledWith(expect.any(String), {
        replaceState: true,
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceDrawer('test-workspace-id', 'agent', 'agent-123'),
      );
    });

    it('should remove selectedTerminal param when navigating to agent', async () => {
      mockPage.url.searchParams.set('selectedTerminal', 'terminal-789');

      await navigateToAgent('agent-123');

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedTerminal=');
      expect(callUrl).toContain('selectedAgent=agent-123');
    });
  });

  describe('navigateToNote', () => {
    it('should dispatch openWorkspaceNote action', async () => {
      await navigateToNote('note-456');

      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceNote('test-workspace-id', 'note-456', {
          openInAdjacentPanel: false,
          openInNewAdjacentPanel: false,
          sourcePanelId: undefined,
        }),
      );
    });

    it('should include workspaceId in dispatched action', async () => {
      await navigateToNote('note-456');

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[0]).toBe('test-workspace-id');
    });

    it('uses an explicit owner workspace instead of the route workspace', async () => {
      await navigateToNote('note-456', { workspaceId: 'owner-workspace' });

      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceNote('owner-workspace', 'note-456', {
          openInAdjacentPanel: false,
          openInNewAdjacentPanel: false,
          sourcePanelId: undefined,
        }),
      );
    });

    it('should handle spec note', async () => {
      await navigateToNote('spec');

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[1]).toBe('spec');
    });
  });

  describe('navigateToFile', () => {
    it('should dispatch openWorkspaceFile action', async () => {
      await navigateToFile('src/index.ts');

      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceFile('test-workspace-id', 'src/index.ts', {
          line: undefined,
          openInAdjacentPanel: false,
          sourcePanelId: undefined,
        }),
      );
    });

    it('should include line number in action when provided', async () => {
      await navigateToFile('src/index.ts', 42);

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[1]).toBe('src/index.ts');
      expect(action.payload[2]?.line).toBe(42);
    });

    it('should not include line number when not provided', async () => {
      await navigateToFile('src/index.ts');

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[2]?.line).toBeUndefined();
    });

    it('should include workspaceId in dispatched action', async () => {
      await navigateToFile('src/index.ts', 42);

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[0]).toBe('test-workspace-id');
    });
  });

  describe('navigateToTerminal', () => {
    it('should set drawer params for terminal navigation', async () => {
      await navigateToTerminal('terminal-789');

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('drawerOpen=1');
      expect(callUrl).toContain('drawerType=terminal');
      expect(callUrl).toContain('selectedTerminal=terminal-789');
      expect(goto).toHaveBeenCalledWith(expect.any(String), {
        replaceState: true,
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        openWorkspaceDrawer('test-workspace-id', 'terminal', 'terminal-789'),
      );
    });

    it('should remove selectedAgent param when navigating to terminal', async () => {
      mockPage.url.searchParams.set('selectedAgent', 'agent-123');

      await navigateToTerminal('terminal-789');

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedAgent=');
      expect(callUrl).toContain('selectedTerminal=terminal-789');
    });
  });

  describe('navigateToSpec', () => {
    it('should dispatch openWorkspaceNote action with spec noteId', async () => {
      // navigateToSpec is a convenience function that calls navigateToNote('spec')
      await navigateToSpec();

      const action = mockDispatch.mock.calls[0][0];
      expect(action.payload[0]).toBe('test-workspace-id');
      expect(action.payload[1]).toBe('spec');
    });
  });

  describe('closeDrawer', () => {
    it('should set drawerOpen to false', async () => {
      mockPage.url.searchParams.set('drawerOpen', '1');

      await closeDrawer();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('drawerOpen=0');
      expect(goto).toHaveBeenCalledWith(expect.any(String), {
        replaceState: true,
      });
      expect(mockDispatch).toHaveBeenCalledWith(closeWorkspaceDrawer('test-workspace-id'));
    });

    it('should clear selectedAgent param', async () => {
      mockPage.url.searchParams.set('selectedAgent', 'agent-123');

      await closeDrawer();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedAgent');
    });

    it('should clear selectedTerminal param', async () => {
      mockPage.url.searchParams.set('selectedTerminal', 'terminal-789');

      await closeDrawer();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedTerminal');
    });

    it('should preserve main content params', async () => {
      mockPage.url.searchParams.set('selectedNoteId', 'note-456');
      mockPage.url.searchParams.set('mainContentType', 'notes');

      await closeDrawer();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('selectedNoteId=note-456');
      expect(callUrl).toContain('mainContentType=notes');
    });
  });

  describe('clearMainContent', () => {
    it('should set mainContentType to empty', async () => {
      await clearMainContent();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('mainContentType=empty');
      expect(goto).toHaveBeenCalledWith(expect.any(String), {
        replaceState: false,
      });
    });

    it('should clear selectedNoteId param', async () => {
      mockPage.url.searchParams.set('selectedNoteId', 'note-456');

      await clearMainContent();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedNoteId');
    });

    it('should clear selectedFile param', async () => {
      mockPage.url.searchParams.set('selectedFile', 'src/index.ts');

      await clearMainContent();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('selectedFile');
    });

    it('should clear line param', async () => {
      mockPage.url.searchParams.set('line', '42');

      await clearMainContent();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).not.toContain('line=');
    });

    it('should preserve drawer params', async () => {
      mockPage.url.searchParams.set('drawerOpen', '1');
      mockPage.url.searchParams.set('drawerType', 'agent');
      mockPage.url.searchParams.set('selectedAgent', 'agent-123');

      await clearMainContent();

      const callUrl = (goto as any).mock.calls[0][0];
      expect(callUrl).toContain('drawerOpen=1');
      expect(callUrl).toContain('drawerType=agent');
      expect(callUrl).toContain('selectedAgent=agent-123');
    });
  });

  describe('navigateToFirstWorkspace', () => {
    it('navigates to the first active workspace', async () => {
      mockWorkspaceItems.value = [
        { id: 'archived-workspace', status: 'Archived' },
        { id: 'active-workspace', status: 'Active' },
      ];

      await navigateToFirstWorkspace();

      expect(goto).toHaveBeenCalledWith('/workspace/active-workspace');
    });

    it('navigates to workspace creation when no workspace is available', async () => {
      await navigateToFirstWorkspace();

      expect(goto).toHaveBeenCalledWith('/workspace/new');
    });

    it('navigates to workspace creation when only archived workspaces exist', async () => {
      mockWorkspaceItems.value = [{ id: 'archived-workspace', status: 'Archived' }];

      await navigateToFirstWorkspace();

      expect(goto).toHaveBeenCalledWith('/workspace/new');
    });
  });

  describe('navigateAfterWorkspaceRemoval', () => {
    it('excludes the removed workspace when choosing the next destination', async () => {
      mockWorkspaceItems.value = [
        { id: 'removed-workspace', status: 'Active' },
        { id: 'remaining-workspace', status: 'Active' },
      ];

      await navigateAfterWorkspaceRemoval('removed-workspace');

      expect(goto).toHaveBeenCalledWith('/workspace/remaining-workspace');
    });

    it('uses the empty-window destination when no workspace remains', async () => {
      mockWorkspaceItems.value = [{ id: 'removed-workspace', status: 'Active' }];

      await navigateAfterWorkspaceRemoval('removed-workspace');

      expect(goto).toHaveBeenCalledWith('/workspace/new');
    });
  });
});

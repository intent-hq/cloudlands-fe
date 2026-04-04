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
} from './workspace-navigation';

const { mockDispatch, mockCloseTab, mockCurrentTabId } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockCloseTab: vi.fn(),
  mockCurrentTabId: { value: null as string | null },
}));

// Mock svelte/store (SvelteKit mocks are in test-setup.ts)
vi.mock('svelte/store', () => ({
  get: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  dispatch: mockDispatch,
  getReduxStore: () => ({ getState: () => ({}) }),
}));

vi.mock('$lib/store/slices/tab-state/tab-state-slice', () => ({
  closeWorkspaceTab: (...args: unknown[]) => mockCloseTab(...args),
}));

vi.mock('$lib/store/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: {
    select: () => mockCurrentTabId.value,
  },
}));

// Import mocked modules
import { goto } from '$app/navigation';
import { get } from 'svelte/store';
import {
  closeWorkspaceDrawer,
  openWorkspaceDrawer,
} from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';

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
    it('should dispatch workspace:open-note event', async () => {
      // The implementation now uses CustomEvents instead of direct URL manipulation
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-note', eventHandler);

      await navigateToNote('note-456');

      expect(eventHandler).toHaveBeenCalled();
      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.noteId).toBe('note-456');
      expect(event.detail.workspaceId).toBe('test-workspace-id');

      window.removeEventListener('workspace:open-note', eventHandler);
    });

    it('should include workspaceId in event detail', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-note', eventHandler);

      await navigateToNote('note-456');

      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.workspaceId).toBe('test-workspace-id');

      window.removeEventListener('workspace:open-note', eventHandler);
    });

    it('should handle spec note', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-note', eventHandler);

      await navigateToNote('spec');

      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.noteId).toBe('spec');

      window.removeEventListener('workspace:open-note', eventHandler);
    });
  });

  describe('navigateToFile', () => {
    it('should dispatch workspace:open-file event', async () => {
      // The implementation now uses CustomEvents instead of direct state manipulation
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-file', eventHandler);

      await navigateToFile('src/index.ts');

      expect(eventHandler).toHaveBeenCalled();
      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.filePath).toBe('src/index.ts');
      expect(event.detail.workspaceId).toBe('test-workspace-id');

      window.removeEventListener('workspace:open-file', eventHandler);
    });

    it('should include line number in event when provided', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-file', eventHandler);

      await navigateToFile('src/index.ts', 42);

      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.filePath).toBe('src/index.ts');
      expect(event.detail.line).toBe(42);

      window.removeEventListener('workspace:open-file', eventHandler);
    });

    it('should not include line number when not provided', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-file', eventHandler);

      await navigateToFile('src/index.ts');

      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.line).toBeUndefined();

      window.removeEventListener('workspace:open-file', eventHandler);
    });

    it('should include workspaceId in event detail', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-file', eventHandler);

      await navigateToFile('src/index.ts', 42);

      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.workspaceId).toBe('test-workspace-id');

      window.removeEventListener('workspace:open-file', eventHandler);
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
    it('should dispatch workspace:open-note event with spec noteId', async () => {
      // navigateToSpec is a convenience function that calls navigateToNote('spec')
      const eventHandler = vi.fn();
      window.addEventListener('workspace:open-note', eventHandler);

      await navigateToSpec();

      expect(eventHandler).toHaveBeenCalled();
      const event = eventHandler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.noteId).toBe('spec');
      expect(event.detail.workspaceId).toBe('test-workspace-id');

      window.removeEventListener('workspace:open-note', eventHandler);
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

  describe('navigateAfterWorkspaceRemoval', () => {
    beforeEach(() => {
      mockCloseTab.mockReset();
      mockCurrentTabId.value = null;
    });

    it('should close the tab for the removed workspace', async () => {
      mockCurrentTabId.value = 'workspace-to-remove';
      mockCloseTab.mockImplementation(() => {
        mockCurrentTabId.value = null;
      });

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(mockCloseTab).toHaveBeenCalledWith('workspace-to-remove');
    });

    it('should navigate to next tab when one exists', async () => {
      // Start with the workspace being removed as the current tab
      mockCurrentTabId.value = 'workspace-to-remove';
      // closeTab mock simulates selecting next tab
      mockCloseTab.mockImplementation(() => {
        mockCurrentTabId.value = 'next-workspace-id';
      });

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(mockCloseTab).toHaveBeenCalledWith('workspace-to-remove');
      expect(goto).toHaveBeenCalledWith('/workspace/next-workspace-id');
    });

    it('should navigate to home when no other tabs exist', async () => {
      mockCurrentTabId.value = null;

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(goto).toHaveBeenCalledWith('/');
    });

    it('should navigate to home when nextTabId is empty string', async () => {
      mockCurrentTabId.value = '' as string;

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(goto).toHaveBeenCalledWith('/');
    });

    it('should navigate to home when nextTabId is sentinel "undefined"', async () => {
      mockCurrentTabId.value = 'undefined';

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(goto).toHaveBeenCalledWith('/');
    });

    it('should navigate to home when nextTabId is sentinel "null"', async () => {
      mockCurrentTabId.value = 'null';

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(goto).toHaveBeenCalledWith('/');
    });

    it('should navigate to home when nextTabId equals the removed workspace id', async () => {
      mockCurrentTabId.value = 'workspace-to-remove';
      // closeTab is a no-op - doesn't change currentTabId
      mockCloseTab.mockImplementation(() => {
        // Tab state corrupted - still points to removed workspace
      });

      await navigateAfterWorkspaceRemoval('workspace-to-remove');

      expect(goto).toHaveBeenCalledWith('/');
    });
  });
});

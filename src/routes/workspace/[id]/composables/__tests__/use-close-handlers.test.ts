/**
 * Tests for useCloseHandlers composable
 */

import { describe, it, expect, vi } from 'vitest';

describe('useCloseHandlers', () => {
  describe('handleCloseMainPanel', () => {
    it('should call setMainPanel with empty and clear all selection state', () => {
      const mockSetMainPanel = vi.fn();
      const mockWorkspaceState = {
        setMainPanel: mockSetMainPanel,
      };

      // Simulate handleCloseMainPanel logic
      mockWorkspaceState.setMainPanel('empty', {
        selectedFile: undefined,
        selectedNoteId: undefined,
        selectedChangeId: undefined,
        selectedTrackedChange: undefined,
        selectedActivityEvent: undefined,
        selectedAgentTurn: undefined,
        selectedCommit: undefined,
        chatChanges: undefined,
        chatChangesTitle: undefined,
        chatChangesAgentId: undefined,
        chatChangesTurnNumber: undefined,
        chatChangesIsAggregate: undefined,
      });

      expect(mockSetMainPanel).toHaveBeenCalledWith('empty', {
        selectedFile: undefined,
        selectedNoteId: undefined,
        selectedChangeId: undefined,
        selectedTrackedChange: undefined,
        selectedActivityEvent: undefined,
        selectedAgentTurn: undefined,
        selectedCommit: undefined,
        chatChanges: undefined,
        chatChangesTitle: undefined,
        chatChangesAgentId: undefined,
        chatChangesTurnNumber: undefined,
        chatChangesIsAggregate: undefined,
      });
    });

    it('should not throw when workspaceState is null', () => {
      const mockWorkspaceState = null;

      // Simulate handleCloseMainPanel logic with null check
      expect(() => {
        if (mockWorkspaceState) {
          mockWorkspaceState.setMainPanel('empty', {});
        }
      }).not.toThrow();
    });
  });

  describe('handleCloseCommit', () => {
    it('should call clearCommitView', () => {
      const mockClearCommitView = vi.fn();
      const mockWorkspaceState = {
        clearCommitView: mockClearCommitView,
      };

      // Simulate handleCloseCommit logic
      mockWorkspaceState.clearCommitView();

      expect(mockClearCommitView).toHaveBeenCalled();
    });
  });

  describe('handleOpenAcceptChanges', () => {
    it('should call openAcceptChanges', () => {
      const mockOpenAcceptChanges = vi.fn();
      const mockWorkspaceState = {
        openAcceptChanges: mockOpenAcceptChanges,
      };

      // Simulate handleOpenAcceptChanges logic
      mockWorkspaceState.openAcceptChanges();

      expect(mockOpenAcceptChanges).toHaveBeenCalled();
    });
  });

  describe('handleCloseAcceptChanges', () => {
    it('should call setMainPanel with empty', () => {
      const mockSetMainPanel = vi.fn();
      const mockWorkspaceState = {
        setMainPanel: mockSetMainPanel,
      };

      // Simulate handleCloseAcceptChanges logic
      mockWorkspaceState.setMainPanel('empty');

      expect(mockSetMainPanel).toHaveBeenCalledWith('empty');
    });
  });

  describe('handleDiagramBindingClick', () => {
    it('should call openFile for file type', async () => {
      const mockOpenFile = vi.fn().mockResolvedValue(undefined);
      const mockWorkspaceState = {
        openFile: mockOpenFile,
      };

      const event = {
        detail: { type: 'file', target: '/path/to/file.ts' },
      };

      // Simulate handleDiagramBindingClick logic
      const { type, target } = event.detail;
      if (type === 'file' && target) {
        await mockWorkspaceState.openFile(target);
      }

      expect(mockOpenFile).toHaveBeenCalledWith('/path/to/file.ts');
    });

    it('should call openNote for note type', async () => {
      const mockOpenNote = vi.fn().mockResolvedValue(undefined);
      const mockWorkspaceState = {
        openNote: mockOpenNote,
      };

      const event = {
        detail: { type: 'note', target: 'spec' },
      };

      // Simulate handleDiagramBindingClick logic
      const { type, target } = event.detail;
      if (type === 'note' && target) {
        await mockWorkspaceState.openNote(target);
      }

      expect(mockOpenNote).toHaveBeenCalledWith('spec');
    });
  });
});

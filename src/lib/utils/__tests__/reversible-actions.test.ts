/**
 * Tests for reversible-actions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock svelte-sonner
vi.mock('svelte-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import {
  reversibleActions,
  deleteWithUndo,
  archiveWithUndo,
  confirmAction,
} from '../reversible-actions';
import { toast } from 'svelte-sonner';

describe('reversible-actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    reversibleActions.cancelAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execute', () => {
    it('should execute action immediately by default', async () => {
      const action = vi.fn();
      const promise = reversibleActions.execute({
        id: 'test-1',
        message: 'Test action',
        action,
      });

      await promise;

      expect(action).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Test action');
    });

    it('should show undo option when onUndo is provided', async () => {
      const action = vi.fn();
      const onUndo = vi.fn();

      await reversibleActions.execute({
        id: 'test-2',
        message: 'Test action',
        action,
        onUndo,
      });

      expect(toast.warning).toHaveBeenCalledWith(
        'Test action',
        expect.objectContaining({
          action: expect.objectContaining({ label: 'Undo' }),
        }),
      );
    });

    it('should return false on action failure', async () => {
      const action = vi.fn().mockRejectedValue(new Error('Failed'));

      const result = await reversibleActions.execute({
        id: 'test-3',
        message: 'Test action',
        action,
      });

      expect(result).toBe(false);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel pending action', async () => {
      const action = vi.fn();

      // Start a non-immediate action
      const promise = reversibleActions.execute({
        id: 'test-cancel',
        message: 'Test',
        action,
        immediate: false,
        showCountdown: true,
        duration: 5,
      });

      // Cancel before execution
      const cancelled = reversibleActions.cancel('test-cancel');
      expect(cancelled).toBe(true);
    });

    it('should return false for non-existent action', () => {
      const cancelled = reversibleActions.cancel('non-existent');
      expect(cancelled).toBe(false);
    });
  });

  describe('getPendingActions', () => {
    it('should return empty array when no pending actions', () => {
      expect(reversibleActions.getPendingActions()).toEqual([]);
    });
  });

  describe('deleteWithUndo', () => {
    it('should execute delete action', async () => {
      const deleteAction = vi.fn();
      const undoAction = vi.fn();

      await deleteWithUndo('item', deleteAction, undoAction);

      expect(deleteAction).toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith('Deleted item', expect.anything());
    });
  });

  describe('archiveWithUndo', () => {
    it('should execute archive action', async () => {
      const archiveAction = vi.fn();
      const unarchiveAction = vi.fn();

      await archiveWithUndo('item', archiveAction, unarchiveAction);

      expect(archiveAction).toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith('Archived item', expect.anything());
    });
  });

  describe('confirmAction', () => {
    it('should execute confirmed action', async () => {
      const action = vi.fn();

      await confirmAction('Confirm this', action);

      expect(action).toHaveBeenCalled();
    });
  });
});

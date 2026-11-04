/**
 * Tests for reversible-actions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock $lib/components/patterns/notify
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: {
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
import { notify } from '$lib/components/patterns/notify';
import { store } from '$store/renderer/store';
import {
  labelWorkspace,
  workspaceLabelsState,
} from '../../../test/fixtures/workspace-labels-state';
import {
  principalIdentityChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import {
  selectHomePersistenceScope,
  selectHomeWorkspaceIsSetAside,
} from '$features/home/home-workspaces-selectors';
import { hydrateHomeWorkspaceSettings } from '$features/home/home-workspaces-slice';
import { readHomePersistence } from '$features/home/home-workspaces-persistence';
import {
  restoreHomeFocusAfterMove,
  setHomeWorkspaceAsideWithUndo,
} from '$features/home/home-set-aside';

function readmitSamePrincipal() {
  const before = store.state.principal;
  store.dispatch(principalIdentityChanged(before.boundPrincipalId!));
  store.dispatch(
    principalReceived(
      {
        context: before.context!,
        invalidation: before.invalidation + 1,
        presentationVersion: before.presentationVersion,
      },
      before.snapshot!,
    ),
  );
}

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
      expect(notify.success).toHaveBeenCalledWith('Test action');
    });

    it('returns false without any toast when the action resolves false (#5777)', async () => {
      const onUndo = vi.fn();
      const result = await reversibleActions.execute({
        id: 'test-reported-failure',
        message: 'Renamed',
        action: async () => false,
        onUndo,
      });

      expect(result).toBe(false);
      expect(notify.warning).not.toHaveBeenCalled();
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.error).not.toHaveBeenCalled();
      expect(onUndo).not.toHaveBeenCalled();

      let current = true;
      let complete!: () => void;
      const action = new Promise<void>((resolve) => (complete = resolve));
      const pending = reversibleActions.execute({
        id: 'test-retired-result',
        message: 'Old caller result',
        action: () => action,
        onUndo,
        isCurrent: () => current,
      });
      current = false;
      complete();
      expect(await pending).toBe(false);
      expect(notify.warning).not.toHaveBeenCalled();
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.error).not.toHaveBeenCalled();
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

      expect(notify.warning).toHaveBeenCalledWith(
        'Test action',
        expect.objectContaining({
          action: expect.objectContaining({ label: 'Undo' }),
        }),
      );

      const workspace = labelWorkspace('ws-target');
      const dispose = store.init(workspaceLabelsState({ workspaces: [workspace] }));
      const element = document.createElement('div');
      try {
        const scope = selectHomePersistenceScope.select(store.state)!;
        store.dispatch(hydrateHomeWorkspaceSettings(scope, readHomePersistence(undefined)));
        vi.mocked(notify.warning).mockClear();
        setHomeWorkspaceAsideWithUndo(workspace);
        await Promise.resolve();
        expect(selectHomeWorkspaceIsSetAside.select(store.state, workspace.id)).toBe(true);
        const options = vi.mocked(notify.warning).mock.calls.at(-1)![1]!;
        const action = options.action;
        expect(action && typeof action === 'object' && 'onClick' in action).toBe(true);
        readmitSamePrincipal();
        if (action && typeof action === 'object' && 'onClick' in action)
          await action.onClick(new MouseEvent('click') as never);
        expect(selectHomeWorkspaceIsSetAside.select(store.state, workspace.id)).toBe(true);

        const button = document.createElement('button');
        button.dataset.homeWorkspace = workspace.id;
        element.append(button);
        document.body.append(element);
        const focus = vi.spyOn(button, 'focus');
        restoreHomeFocusAfterMove(() => element, null, workspace.id);
        await vi.advanceTimersByTimeAsync(40);
        expect(focus).toHaveBeenCalledOnce();
        button.blur();
        focus.mockClear();
        restoreHomeFocusAfterMove(() => element, null, workspace.id);
        readmitSamePrincipal();
        await vi.advanceTimersByTimeAsync(40);
        expect(focus).not.toHaveBeenCalled();
      } finally {
        element.remove();
        dispose();
      }
    });

    it('opts the undo toast into the countdown bar with the toast duration', async () => {
      const action = vi.fn();
      const onUndo = vi.fn();

      await reversibleActions.execute({
        id: 'test-countdown-bar',
        message: 'Test action',
        action,
        onUndo,
        duration: 15,
      });

      expect(notify.warning).toHaveBeenCalledWith(
        'Test action',
        expect.objectContaining({
          duration: 15000,
          class: expect.stringContaining('toast-countdown'),
          style: expect.stringContaining('--toast-countdown-duration: 15000ms'),
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
      expect(notify.error).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel pending action', async () => {
      const action = vi.fn();

      // Start a non-immediate action
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      expect(notify.warning).toHaveBeenCalledWith('Deleted item', expect.anything());
    });
  });

  describe('archiveWithUndo', () => {
    it('should execute archive action', async () => {
      const archiveAction = vi.fn();
      const unarchiveAction = vi.fn();

      await archiveWithUndo('item', archiveAction, unarchiveAction);

      expect(archiveAction).toHaveBeenCalled();
      expect(notify.warning).toHaveBeenCalledWith('Archived item', expect.anything());
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

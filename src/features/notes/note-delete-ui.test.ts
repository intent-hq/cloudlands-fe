import { beforeEach, expect, it, vi } from 'vitest';
import type { NoteDeleteView } from '$store/renderer/slices/workspace-notes/note-delete-state';
const control = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => control.state, dispatch: control.dispatch });
});
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { custom: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('./NoteDeleteStatus.svelte', () => ({ default: {} }));
import { notify } from '$lib/components/patterns/notify';
import {
  captureNoteDeleteTab,
  checkNoteDeleteFromUi,
  closeScheduledNoteTab,
  noteDeleteUiTarget,
  canUndoNoteDelete,
  scheduleNoteDeleteFromUi,
  undoNoteDeleteFromUi,
  observeNoteDeletionWorkspace,
  selectNoteDeletionPaused,
} from './note-delete-ui';
import { noteDeleteKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
const view = (): NoteDeleteView => ({
  backendGeneration: 1,
  workspaceId: 'ws',
  noteId: 'note',
  noteInstanceId: 'instance',
  owner: 'owner',
  phase: 'pending',
  held: true,
  hidden: true,
  canCancel: true,
  deadline: performance.now() + 15000,
  receipt: {
    workspaceId: 'ws',
    noteId: 'note',
    noteInstanceId: 'instance',
    state: 'PENDING',
    operationKey: { epoch: 'epoch', nonce: 'nonce', issuedTickMs: 0 },
    sequence: 1,
    deadlineTickMs: 15000,
    deleteAt: '2026-10-08T15:00:00Z',
    expiresTickMs: null,
    reason: null,
  },
});
function put(value: NoteDeleteView) {
  control.state.workspaceNotes.deleteOperations[noteDeleteKey(1, 'ws', 'note')] = value;
}
beforeEach(() => {
  vi.clearAllMocks();
  control.dispatch.mockReset();
  control.state = {
    daemonHealth: { connectionGeneration: 1 },
    workspaceNotes: { deleteOperations: {} },
    panelLayout: {
      byWorkspaceId: {
        ws: {
          panels: {
            panel: {
              id: 'panel',
              activeTabId: 'tab',
              tabs: [{ id: 'tab', type: 'note', workspaceId: 'ws', noteId: 'note' }],
            },
          },
        },
      },
    },
  };
});
it('schedules only the scoped note and uses a key-only toast after acknowledgement', async () => {
  let action: any;
  control.dispatch.mockImplementation((a) => {
    action = a;
  });
  const scheduling = scheduleNoteDeleteFromUi('ws', 'note', 'Title');
  expect(control.dispatch.mock.calls[0][0]).toMatchObject({
    asyncActionType: 'workspaceNotes/scheduleNoteDeleteRequested',
    payload: ['ws', 'note'],
  });
  expect(notify.custom).not.toHaveBeenCalled();
  const pending = view();
  put(pending);
  action.success(pending);
  expect(await scheduling).toEqual(pending);
  expect(notify.custom).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      componentProps: expect.objectContaining({
        target: {
          backendGeneration: 1,
          workspaceId: 'ws',
          noteId: 'note',
          owner: 'owner',
          noteInstanceId: 'instance',
          operationKey: pending.receipt!.operationKey,
        },
        title: 'Title',
      }),
    }),
  );
  expect(control.dispatch).toHaveBeenCalledTimes(1);
});
it('never schedules the spec or closes a tab after rejected scheduling', async () => {
  expect(await scheduleNoteDeleteFromUi('ws', 'spec', 'Spec')).toBeUndefined();
  expect(control.dispatch).not.toHaveBeenCalled();
  control.dispatch.mockImplementation((a) => a.failure(new Error('transport lost')));
  expect(await scheduleNoteDeleteFromUi('ws', 'note', 'Title')).toBeUndefined();
  expect(notify.error).toHaveBeenCalled();
  expect(control.dispatch).toHaveBeenCalledTimes(1);
});
it('rejects expired Undo and stale toast identities before dispatch', async () => {
  const pending = view();
  put(pending);
  const target = noteDeleteUiTarget(pending);
  expect(canUndoNoteDelete(pending, pending.deadline! - 1)).toBe(true);
  expect(canUndoNoteDelete(pending, pending.deadline!)).toBe(false);
  put({ ...pending, deadline: 0 });
  await expect(undoNoteDeleteFromUi(target)).rejects.toThrow();
  put({ ...pending, owner: 'new-intent' });
  await expect(undoNoteDeleteFromUi(target)).rejects.toThrow();
  await expect(checkNoteDeleteFromUi(target)).rejects.toThrow();
  put(pending);
  control.state.daemonHealth.connectionGeneration = 2;
  await expect(undoNoteDeleteFromUi(target)).rejects.toThrow();
  expect(control.dispatch).not.toHaveBeenCalled();
});
it('Undo only cancels the retained original operation and never recreates or opens a note', async () => {
  const pending = view();
  put(pending);
  const cancelled = {
    ...pending,
    phase: 'cancelled' as const,
    canCancel: false,
    hidden: false,
    held: false,
  };
  control.dispatch.mockImplementation((a) => a.success(cancelled));
  expect(await undoNoteDeleteFromUi(noteDeleteUiTarget(pending))).toEqual(cancelled);
  expect(
    control.dispatch.mock.calls.map(([a]) => ({ type: a.asyncActionType, payload: a.payload })),
  ).toEqual([{ type: 'workspaceNotes/cancelNoteDeleteRequested', payload: ['ws', 'note'] }]);
});
it('closes only the captured still-current initiating tab after confirmed pending', () => {
  const pending = view();
  put(pending);
  const captured = captureNoteDeleteTab('ws', 'tab', 'ws', 'note');
  expect(captured).toBeDefined();
  closeScheduledNoteTab(captured, { ...pending, phase: 'uncertain' });
  expect(control.dispatch).not.toHaveBeenCalled();
  closeScheduledNoteTab(captured, pending);
  expect(control.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'panelLayout/closeTab',
      payload: expect.objectContaining({
        wsId: 'ws',
        tabId: 'tab',
        panelId: 'panel',
        preservePanel: true,
      }),
    }),
  );
});
it('does not close a replacement, moved tab or tab on another backend', () => {
  const pending = view();
  put(pending);
  const captured = captureNoteDeleteTab('ws', 'tab', 'ws', 'note');
  const panel = control.state.panelLayout.byWorkspaceId.ws.panels.panel;
  panel.tabs = [{ ...panel.tabs[0] }];
  closeScheduledNoteTab(captured, pending);
  const replacement = captureNoteDeleteTab('ws', 'tab', 'ws', 'note');
  panel.tabs = [];
  closeScheduledNoteTab(replacement, pending);
  control.state.daemonHealth.connectionGeneration = 2;
  closeScheduledNoteTab(replacement, pending);
  expect(control.dispatch).not.toHaveBeenCalled();
});
it('pairs workspace observation with the same owner on cleanup', () => {
  const off = observeNoteDeletionWorkspace('ws', 'sidebar');
  off();
  expect(control.dispatch.mock.calls.map(([a]) => ({ type: a.type, payload: a.payload }))).toEqual([
    { type: 'workspaceNotes/noteDeleteWorkspaceObserved', payload: ['ws', 'sidebar'] },
    { type: 'workspaceNotes/noteDeleteWorkspaceUnobserved', payload: ['ws', 'sidebar'] },
  ]);
});

it('allows authorized recovered pending operations and rejects a newer key under the same view owner', async () => {
  const original = view();
  const receipt = original.receipt!;
  const recovered = {
    ...original,
    receipt: undefined,
    pending: {
      operationKey: receipt.operationKey,
      noteId: 'note',
      noteInstanceId: 'instance',
      state: 'PENDING' as const,
      sequence: 1,
      deadlineTickMs: 15000,
      deleteAt: receipt.deleteAt,
      canCancel: true,
    },
  };
  put(recovered);
  const target = noteDeleteUiTarget(recovered);
  expect(canUndoNoteDelete(recovered, recovered.deadline! - 1)).toBe(true);
  put({
    ...recovered,
    pending: {
      ...recovered.pending,
      operationKey: { ...receipt.operationKey, nonce: 'new-intent' },
    },
  });
  await expect(undoNoteDeleteFromUi(target)).rejects.toThrow();
  expect(control.dispatch).not.toHaveBeenCalled();
});
it('does not close the tab if cancellation settled while feedback was loading', () => {
  const original = view();
  put(original);
  const capture = captureNoteDeleteTab('ws', 'tab', 'ws', 'note');
  put({ ...original, phase: 'cancelled', held: false, hidden: false, canCancel: false });
  closeScheduledNoteTab(capture, original);
  expect(control.dispatch).not.toHaveBeenCalled();
});

it('scopes workspace pause to its backend generation while allowing an explicit UI admission check', async () => {
  const pending = view();
  put(pending);
  control.state.workspaceNotes.deleteObservationPaused = { ws: 1 };
  expect(selectNoteDeletionPaused.select(control.state, 'ws')).toBe(true);
  expect(selectNoteDeletionPaused.select(control.state, 'other')).toBe(false);
  control.dispatch.mockImplementation((action) => action.success(pending));
  await checkNoteDeleteFromUi(noteDeleteUiTarget(pending));
  expect(control.dispatch).toHaveBeenCalledTimes(1);
  expect(control.dispatch.mock.calls[0][0].asyncActionType).toBe(
    'workspaceNotes/checkNoteDeleteRequested',
  );
  control.state.daemonHealth.connectionGeneration = 2;
  expect(selectNoteDeletionPaused.select(control.state, 'ws')).toBe(false);
});

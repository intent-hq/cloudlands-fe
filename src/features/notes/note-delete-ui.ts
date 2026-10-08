import { store as appStore } from '$store/renderer/store';
import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPanelLayoutWorkspace } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import {
  noteDeleteKey,
  type NoteDeleteView,
  type NoteDeleteRecoveryDraft,
  type NoteDeleteDraftOwner,
  noteDeleteDraftKey,
} from '$store/renderer/slices/workspace-notes/note-delete-state';
import {
  scheduleNoteDeleteRequested,
  cancelNoteDeleteRequested,
  checkNoteDeleteRequested,
  noteDeleteWorkspaceObserved,
  noteDeleteWorkspaceUnobserved,
  noteDeleteRecoveryDiscarded,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { isSpecNote } from '$shared/constants/notes';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { noteDeleteKeyEquals, type NoteDeleteKey } from '$lib/client/note-delete';

export type NoteDeleteUiTarget = Pick<
  NoteDeleteView,
  'backendGeneration' | 'workspaceId' | 'noteId' | 'owner' | 'noteInstanceId'
> & { operationKey?: NoteDeleteKey };
export const noteDeleteUiTarget = (view: NoteDeleteView): NoteDeleteUiTarget => ({
  backendGeneration: view.backendGeneration,
  workspaceId: view.workspaceId,
  noteId: view.noteId,
  owner: view.owner,
  noteInstanceId: view.noteInstanceId,
  operationKey: (view.pending ?? view.receipt ?? view.request)?.operationKey,
});
export const selectNoteDeletion = appStore.createSelector(
  (state, workspaceId: string, noteId: string): NoteDeleteView | undefined =>
    state.workspaceNotes.deleteOperations?.[
      noteDeleteKey(state.daemonHealth.connectionGeneration, workspaceId, noteId)
    ],
);
export const selectWorkspaceNoteDeletions = appStore.createSelector(
  (state, workspaceId: string): NoteDeleteView[] =>
    Object.values(state.workspaceNotes.deleteOperations ?? {}).filter(
      (view) =>
        view.backendGeneration === state.daemonHealth.connectionGeneration &&
        view.workspaceId === workspaceId,
    ),
);

export const selectNoteDeletionChecking = appStore.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.deleteObservationChecking?.[workspaceId] ===
    state.daemonHealth.connectionGeneration,
);
export const selectNoteDeletionPaused = appStore.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.deleteObservationPaused?.[workspaceId] ===
    state.daemonHealth.connectionGeneration,
);

export const selectNoteDeletionObservationError = appStore.createSelector(
  (state, workspaceId: string): string | undefined =>
    state.workspaceNotes.deleteObservationErrors?.[workspaceId],
);

export function observeNoteDeletionWorkspace(workspaceId: string, owner: string): () => void {
  appStore.dispatch(noteDeleteWorkspaceObserved(workspaceId, owner));
  return () => {
    appStore.dispatch(noteDeleteWorkspaceUnobserved(workspaceId, owner));
  };
}
export function matchesNoteDeleteTarget(
  view: NoteDeleteView | undefined,
  target: NoteDeleteUiTarget,
): view is NoteDeleteView {
  if (
    !view ||
    view.backendGeneration !== target.backendGeneration ||
    view.owner !== target.owner ||
    view.workspaceId !== target.workspaceId ||
    view.noteId !== target.noteId ||
    (target.noteInstanceId !== undefined && view.noteInstanceId !== target.noteInstanceId)
  )
    return false;
  const key = (view.pending ?? view.receipt ?? view.request)?.operationKey;
  return (
    target.operationKey === undefined || (!!key && noteDeleteKeyEquals(key, target.operationKey))
  );
}
function current(target: NoteDeleteUiTarget): NoteDeleteView | undefined {
  const view = selectNoteDeletion.select(appStore.state, target.workspaceId, target.noteId);
  return matchesNoteDeleteTarget(view, target) ? view : undefined;
}
export function canUndoNoteDelete(view: NoteDeleteView | undefined, now: number): boolean {
  return (
    !!view?.canCancel &&
    view.failureCode !== 'registration-limit' &&
    (view.pending ?? view.receipt)?.state === 'PENDING' &&
    view.deadline !== undefined &&
    now < view.deadline
  );
}
export async function undoNoteDeleteFromUi(target: NoteDeleteUiTarget): Promise<NoteDeleteView> {
  if (!canUndoNoteDelete(current(target), performance.now()))
    throw new Error(m.notes_delete_undoUnavailable_error());
  return appStore.dispatch(cancelNoteDeleteRequested(target.workspaceId, target.noteId));
}
export async function checkNoteDeleteFromUi(
  target: NoteDeleteUiTarget,
): Promise<NoteDeleteView | undefined> {
  if (!current(target)) throw new Error(m.notes_delete_changed_error());
  return appStore.dispatch(checkNoteDeleteRequested(target.workspaceId, target.noteId));
}
async function showFeedback(view: NoteDeleteView, title: string) {
  const target = noteDeleteUiTarget(view);
  const { default: NoteDeleteStatus } = await import('./NoteDeleteStatus.svelte');
  if (!current(target)) return;
  const key = JSON.stringify([
    'note-delete',
    target.backendGeneration,
    target.workspaceId,
    target.noteId,
    target.owner,
  ]);
  notify.custom(NoteDeleteStatus, {
    key,
    duration: Infinity,
    componentProps: { target, title, onClose: () => notify.dismiss(key) },
  });
}
export async function scheduleNoteDeleteFromUi(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<NoteDeleteView | undefined> {
  if (isSpecNote(noteId)) {
    notify.error(m.layout_noteTab_cannotDeleteSpec_error());
    return undefined;
  }
  const generation = appStore.state.daemonHealth.connectionGeneration;
  try {
    const result = await appStore.dispatch(scheduleNoteDeleteRequested(workspaceId, noteId));
    await showFeedback(result, title);
    return result;
  } catch {
    const view = selectNoteDeletion.select(appStore.state, workspaceId, noteId);
    if (view?.backendGeneration === generation) await showFeedback(view, title);
    notify.error(m.notes_delete_requestFailed_error());
    return undefined;
  }
}

/** Capture the exact tab object, never close all tabs sharing a textual note ID. */
export function captureNoteDeleteTab(
  layoutId: string,
  tabId: string,
  workspaceId: string,
  noteId: string,
) {
  const layout = selectPanelLayoutWorkspace.select(appStore.state, layoutId);
  for (const panel of Object.values(layout.panels)) {
    const tab = panel.tabs.find(
      (entry) =>
        entry.id === tabId &&
        entry.type === 'note' &&
        entry.noteId === noteId &&
        (!entry.workspaceId || entry.workspaceId === workspaceId),
    );
    if (tab)
      return {
        layoutId,
        panelId: panel.id,
        tab,
        workspaceId,
        noteId,
        backendGeneration: appStore.state.daemonHealth.connectionGeneration,
      };
  }
  return undefined;
}
export function closeScheduledNoteTab(
  capture: ReturnType<typeof captureNoteDeleteTab>,
  view: NoteDeleteView,
): void {
  if (
    !capture ||
    view.phase !== 'pending' ||
    view.receipt?.state !== 'PENDING' ||
    view.noteInstanceId !== view.receipt.noteInstanceId ||
    view.workspaceId !== capture.workspaceId ||
    view.noteId !== capture.noteId ||
    view.backendGeneration !== capture.backendGeneration ||
    !current(noteDeleteUiTarget(view))
  )
    return;
  const live = current(noteDeleteUiTarget(view));
  if (
    live?.phase !== 'pending' ||
    live.receipt?.state !== 'PENDING' ||
    live.noteInstanceId !== view.noteInstanceId
  )
    return;
  const layout = selectPanelLayoutWorkspace.select(appStore.state, capture.layoutId);
  if (!layout.panels[capture.panelId]?.tabs.some((tab) => tab === capture.tab)) return;
  // Keeping the panel avoids shifting focus when the user moved elsewhere during admission.
  appStore.dispatch(
    closeTab(capture.layoutId, capture.tab.id, capture.panelId, undefined, { preservePanel: true }),
  );
}

// Recovery is local retained input, not authority to write to the selected backend.
export const selectNoteDeleteRecoveryDrafts = appStore.createSelector(
  (state, workspaceId: string, noteId?: string): NoteDeleteRecoveryDraft[] =>
    Object.values(state.workspaceNotes.deleteRecoveryDrafts ?? {}).filter(
      (draft) =>
        draft.workspaceId === workspaceId && (noteId === undefined || draft.noteId === noteId),
    ),
);
export function noteDeleteRecoveryOwner(draft: NoteDeleteRecoveryDraft): NoteDeleteDraftOwner {
  return {
    backendGeneration: draft.backendGeneration,
    workspaceId: draft.workspaceId,
    noteId: draft.noteId,
    ownerId: draft.ownerId,
  };
}
export function discardNoteDeleteRecovery(owner: NoteDeleteDraftOwner): void {
  appStore.dispatch(noteDeleteRecoveryDiscarded(owner));
}
export function exportNoteDeleteRecovery(owner: NoteDeleteDraftOwner): void {
  const draft = appStore.state.workspaceNotes.deleteRecoveryDrafts?.[noteDeleteDraftKey(owner)];
  if (!draft) return;
  const blob = new Blob([draft.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const name = `${draft.noteId}-${draft.backendGeneration}-${draft.ownerId}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
  link.download = `${name.slice(0, 180)}.md`;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

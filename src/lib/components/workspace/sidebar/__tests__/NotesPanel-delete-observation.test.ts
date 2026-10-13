/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import NotesPanel from '../NotesPanel.svelte';
import { store as appStore } from '$store/renderer/store';
import { noteDeleteDraftKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
import {
  noteDeleteObservationFailed,
  noteDeleteObservationCheckingChanged,
  noteDeleteWorkspaceCheckRequested,
  noteDeleteRecoveryRetained,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { m } from '$shared/paraglide/messages.js';

beforeEach(() => appStore.init());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('offers a scoped status check after an initial snapshot failure with no note operations', async () => {
  const view = render(NotesPanel, { notes: [], workspaceId: 'failed-workspace' });
  appStore.dispatch(noteDeleteObservationFailed('failed-workspace', 'Snapshot unavailable'));
  const check = await view.findByRole('button', { name: m.notes_delete_check_label() });
  expect(view.getByText(m.notes_delete_workspaceCheckFailed_error())).toBeTruthy();
  const dispatch = vi.spyOn(appStore, 'dispatch');
  await fireEvent.click(check);
  expect(dispatch).toHaveBeenCalledWith(noteDeleteWorkspaceCheckRequested('failed-workspace'));
  expect(dispatch).toHaveBeenCalledTimes(1);

  // Clearing the error is the observer's authoritative recovery signal.
  appStore.dispatch(noteDeleteObservationFailed('failed-workspace', null));
  await waitFor(() =>
    expect(view.queryByRole('button', { name: m.notes_delete_check_label() })).toBeNull(),
  );
});

it('does not expose another workspace failure after the sidebar changes workspace', async () => {
  const view = render(NotesPanel, { notes: [], workspaceId: 'failed-workspace' });
  appStore.dispatch(noteDeleteObservationFailed('failed-workspace', 'Snapshot unavailable'));
  await view.findByRole('button', { name: m.notes_delete_check_label() });
  await view.rerender({ notes: [], workspaceId: 'healthy-workspace' });
  await waitFor(() =>
    expect(view.queryByText(m.notes_delete_workspaceCheckFailed_error())).toBeNull(),
  );
  appStore.dispatch(noteDeleteObservationFailed('healthy-workspace', 'Snapshot unavailable'));
  const check = await view.findByRole('button', { name: m.notes_delete_check_label() });
  const dispatch = vi.spyOn(appStore, 'dispatch');
  await fireEvent.click(check);
  expect(dispatch).toHaveBeenCalledWith(noteDeleteWorkspaceCheckRequested('healthy-workspace'));
});

it('allows busy-guarded manual workspace checks during pause while recovery remains reachable', async () => {
  const workspaceId = 'paused-workspace';
  const generation = appStore.state.daemonHealth.connectionGeneration;
  const draft = {
    backendGeneration: generation,
    workspaceId,
    noteId: 'note',
    ownerId: 'editor',
    content: 'unsaved text',
    baseContent: 'base',
  };
  const view = render(NotesPanel, { notes: [], workspaceId });
  appStore.dispatch(noteDeleteRecoveryRetained(draft));
  appStore.dispatch(
    noteDeleteObservationFailed(workspaceId, 'capacity', {
      backendGeneration: generation,
      paused: true,
    }),
  );
  const check = (await view.findByRole('button', {
    name: m.notes_delete_check_label(),
  })) as HTMLButtonElement;
  expect(check.disabled).toBe(false);
  expect(view.getByText(m.notes_delete_registrationPaused_label())).toBeTruthy();
  const createObjectURL = vi.fn(() => 'blob:paused-draft');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const dispatch = vi.spyOn(appStore, 'dispatch');
  await fireEvent.click(check);
  expect(dispatch).toHaveBeenCalledWith(noteDeleteWorkspaceCheckRequested(workspaceId));
  appStore.dispatch(noteDeleteObservationCheckingChanged(workspaceId, generation, true));
  await waitFor(() => expect(check.disabled).toBe(true));
  dispatch.mockClear();
  await fireEvent.click(check);
  expect(dispatch).not.toHaveBeenCalled();
  const exportDraft = view.getByRole('button', {
    name: m.notes_delete_recoveryExport_label(),
  }) as HTMLButtonElement;
  expect(exportDraft.disabled).toBe(false);
  await fireEvent.click(exportDraft);
  expect(click).toHaveBeenCalledTimes(1);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
  const discard = view.getByRole('button', {
    name: m.notes_delete_recoveryDiscard_label(),
  }) as HTMLButtonElement;
  expect(discard.disabled).toBe(false);
  await fireEvent.click(discard);
  expect(
    appStore.state.workspaceNotes.deleteRecoveryDrafts?.[noteDeleteDraftKey(draft)],
  ).toBeUndefined();
  expect(appStore.state.workspaceNotes.deleteObservationPaused?.[workspaceId]).toBe(generation);
  expect(
    dispatch.mock.calls.every(
      ([action]) => action.type !== 'workspaceNotes/noteDeleteWorkspaceCheckRequested',
    ),
  ).toBe(true);
  appStore.dispatch(
    noteDeleteObservationFailed(workspaceId, null, {
      backendGeneration: generation,
      paused: false,
    }),
  );
  await waitFor(() =>
    expect(view.queryByRole('button', { name: m.notes_delete_check_label() })).toBeNull(),
  );
});
it('does not apply capacity feedback from an earlier backend generation', async () => {
  const workspaceId = 'current-workspace';
  const generation = appStore.state.daemonHealth.connectionGeneration;
  appStore.dispatch(
    noteDeleteObservationFailed(workspaceId, 'old capacity refusal', {
      backendGeneration: generation - 1,
      paused: true,
    }),
  );
  const view = render(NotesPanel, { notes: [], workspaceId });
  const check = (await view.findByRole('button', {
    name: m.notes_delete_check_label(),
  })) as HTMLButtonElement;
  expect(check.disabled).toBe(false);
  expect(view.queryByText(m.notes_delete_registrationPaused_label())).toBeNull();
});

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteDeleteRecoveryDraft } from '$store/renderer/slices/workspace-notes/note-delete-state';
const control = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => control.state, dispatch: control.dispatch });
});
import { store } from '$store/renderer/store';
import NoteDeleteRecovery from './NoteDeleteRecovery.svelte';
import { noteDeleteDraftKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
import { noteDeleteRecoveryDiscarded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { noteDeleteRecoveryOwner } from './note-delete-ui';
import { m } from '$shared/paraglide/messages.js';
const draft = (generation: number, ownerId: string, content: string): NoteDeleteRecoveryDraft => ({
  backendGeneration: generation,
  workspaceId: 'ws',
  noteId: 'note',
  ownerId,
  content,
  baseContent: 'base',
});
const old = draft(1, 'old-editor', 'unsaved earlier connection');
const current = draft(2, 'new-editor', 'unsaved current connection');
const createObjectURL = vi.fn((_blob: Blob) => 'blob:recovery-draft');
const revokeObjectURL = vi.fn();
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  control.state = {
    daemonHealth: { connectionGeneration: 2 },
    workspaceNotes: {
      deleteRecoveryDrafts: Object.fromEntries(
        [old, current].map((d) => [noteDeleteDraftKey(d), d]),
      ),
    },
  };
  control.dispatch.mockImplementation((action) => {
    if (action.type === 'workspaceNotes/noteDeleteRecoveryDiscarded') {
      delete control.state.workspaceNotes.deleteRecoveryDrafts[
        noteDeleteDraftKey(action.payload[0])
      ];
      (store as unknown as { emitState(): void }).emitState();
    }
  });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps earlier-connection input exportable without writing it to the current backend', async () => {
  const view = render(NoteDeleteRecovery, { workspaceId: 'ws', noteId: 'note' });
  const origin = view.getByText(m.notes_delete_recoveryEarlier_label());
  const oldRow = within(origin.parentElement!);
  await fireEvent.click(
    oldRow.getByRole('button', { name: m.notes_delete_recoveryExport_label() }),
  );
  expect(click).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  expect(text).toBe(old.content);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery-draft'));
  expect(control.dispatch).not.toHaveBeenCalled();
  expect(control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(old)]).toEqual(old);
  expect(view.getAllByRole('button')).toHaveLength(4);
});

it('discards only the exact old owner while preserving another generation of the same note', async () => {
  const view = render(NoteDeleteRecovery, { workspaceId: 'ws', noteId: 'note' });
  const oldRow = within(view.getByText(m.notes_delete_recoveryEarlier_label()).parentElement!);
  await fireEvent.click(
    oldRow.getByRole('button', { name: m.notes_delete_recoveryDiscard_label() }),
  );
  expect(control.dispatch).toHaveBeenCalledExactlyOnceWith(
    noteDeleteRecoveryDiscarded(noteDeleteRecoveryOwner(old)),
  );
  await waitFor(() => expect(view.queryByText(m.notes_delete_recoveryEarlier_label())).toBeNull());
  expect(control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(current)]).toEqual(
    current,
  );
});

it('scopes recovery presentation to the selected workspace and optional note', async () => {
  const view = render(NoteDeleteRecovery, { workspaceId: 'foreign' });
  expect(view.queryByRole('region')).toBeNull();
  await view.rerender({ workspaceId: 'ws', noteId: 'other-note' });
  (store as unknown as { emitState(): void }).emitState();
  expect(view.queryByRole('region')).toBeNull();
  await view.rerender({ workspaceId: 'ws', noteId: 'note' });
  (store as unknown as { emitState(): void }).emitState();
  await waitFor(() => expect(view.queryByRole('region')).not.toBeNull());
  expect(view.getAllByRole('button', { name: m.notes_delete_recoveryExport_label() })).toHaveLength(
    2,
  );
});

it('relabels retained current drafts after connection change without making them unreachable', async () => {
  const view = render(NoteDeleteRecovery, { workspaceId: 'ws', noteId: 'note' });
  expect(view.getByText(m.notes_delete_recoveryCurrent_label())).toBeTruthy();
  control.state.daemonHealth.connectionGeneration = 3;
  (store as unknown as { emitState(): void }).emitState();
  await waitFor(() => expect(view.queryByText(m.notes_delete_recoveryCurrent_label())).toBeNull());
  expect(view.getAllByText(m.notes_delete_recoveryEarlier_label())).toHaveLength(2);
  expect(view.getAllByRole('button', { name: m.notes_delete_recoveryExport_label() })).toHaveLength(
    2,
  );
});

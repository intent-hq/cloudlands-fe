// i18n-ignore (internal unreleased read-only workspace preview)
import { Link } from '@tanstack/react-router';
import { useId, useLayoutEffect } from 'react';
import { LoadingState } from '@/components/patterns/screen';
import { NoteContentSurface } from '@/features/layout/tab-types/note-content-surface';
import { store } from '@/store';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectAllNotes,
  selectNoteById,
  selectNoteContentView,
  selectWorkspaceNotesState,
} from '@/store/workspace-notes/workspace-notes-selectors';
import {
  noteContentViewReleased,
  noteContentViewRequested,
  selectNote,
  workspaceNotesHydrationRequested,
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { workspaceUnmounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

let nextHydrationGeneration = 0;

function NoteContent({ workspaceId, noteId }: { workspaceId: string; noteId: string }) {
  const consumerId = useId();
  const authority = selectPrincipalConnectionContext();
  const note = selectNoteById(workspaceId, noteId);
  const view = selectNoteContentView(workspaceId, consumerId);
  const connection = authority.value;
  useLayoutEffect(() => {
    if (!connection) return;
    store.dispatch(selectNote(workspaceId, noteId));
    store.dispatch(noteContentViewRequested(consumerId, crypto.randomUUID(), workspaceId, noteId));
    return () => {
      store.dispatch(noteContentViewReleased(workspaceId, consumerId));
    };
  }, [consumerId, workspaceId, noteId, connection]);
  const current = view.value?.noteId === noteId ? view.value : undefined;
  const ready = current?.status === 'ready' && current.authority === connection;
  const failed = current?.status === 'error' && current.authority === connection;
  return (
    <NoteContentSurface state={failed ? 'error' : !ready ? 'loading' : 'read-only'}>
      {failed ? (
        <p role="alert">{current.error}</p>
      ) : !ready ? (
        <LoadingState label="Loading note content" />
      ) : (
        <article className="grid min-w-0 gap-4" data-testid="workspace-note" data-note-id={noteId}>
          <header className="grid gap-1">
            <h2 className="type-heading-sm">{note.value?.title}</h2>
            <p className="type-caption text-muted-foreground">Read-only Markdown source</p>
          </header>
          <pre
            className="min-w-0 whitespace-pre-wrap break-words font-sans"
            data-testid="note-content"
          >
            {note.value?.content}
          </pre>
        </article>
      )}
    </NoteContentSurface>
  );
}

export function WorkspaceNotes({ workspaceId, noteId }: { workspaceId: string; noteId?: string }) {
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const state = selectWorkspaceNotesState(workspaceId);
  const notes = selectAllNotes(workspaceId);
  const connection = authority.value;
  useLayoutEffect(() => {
    if (!connection) return;
    store.dispatch(workspaceNotesHydrationRequested(workspaceId, ++nextHydrationGeneration, true));
    return () => {
      store.dispatch(workspaceUnmounted(workspaceId));
    };
  }, [workspaceId, connection]);
  if (!connection) return <p>Notes are not available for the current connection.</p>;
  if (state.value.error) return <p role="alert">{state.value.error}</p>;
  if (!state.value.initialized) return <LoadingState label="Loading notes" />;
  if (notes.value.length === 0) return <p>This workspace has no notes.</p>;
  return (
    <section className="grid min-w-0 gap-6" data-testid="workspace-notes">
      {noteId ? (
        <>
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId }}
            search={{}}
            className="w-fit text-muted-foreground hover:text-foreground"
          >
            All notes
          </Link>
          <NoteContent key={noteId} workspaceId={workspaceId} noteId={noteId} />
        </>
      ) : (
        <>
          <h2 className="type-heading-sm">Notes</h2>
          <ul className="grid gap-1">
            {notes.value.map((note) => (
              <li key={note.id}>
                <Link
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId }}
                  search={{ note: String(note.id) }}
                  className="block rounded-md px-3 py-3 hover:bg-muted focus-visible:outline"
                  data-note-id={note.id}
                >
                  {note.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

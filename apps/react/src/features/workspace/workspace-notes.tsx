// i18n-ignore (internal unreleased read-only workspace preview)
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownViewer } from '@/components/markdown/markdown-viewer';
import { Button } from '@/components/ui/button';
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
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
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { parseIntentLink } from '$shared/utils/intent-link-parser';
import type { LinkHandlerOptions } from '$shared/utils/link-helpers';
import { WorkspaceId } from '$shared/types/branded-ids';
import { filterContextNotes } from '$lib/components/workspace/sidebar/sidebar-search';
import { m } from '$shared/paraglide/messages.js';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { selectNoteEditReady } from '@/store/workspace-notes/note-edit-selectors';
import { WorkspaceNoteEditor } from './workspace-note-editor';
import { WorkspaceTaskStatus } from './workspace-task-status';
import { WorkspaceNoteCreate } from './workspace-note-create';

function NoteContent({
  workspaceId,
  noteId,
  query,
  fileQuery,
  startEditing = false,
}: {
  startEditing?: boolean;
  workspaceId: string;
  noteId: string;
  query: string;
  fileQuery?: string;
}) {
  const consumerId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const openedEditor = useRef(false);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const authority = selectPrincipalConnectionContext();
  const admitted = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const note = selectNoteById(workspaceId, noteId);
  const notesLoaded = selectWorkspaceNotesState(workspaceId).value.initialized;
  const view = selectNoteContentView(workspaceId, consumerId);
  const editable = selectNoteEditReady(workspaceId, noteId, consumerId).value;
  const connection = authority.value;
  useLayoutEffect(() => {
    if (startEditing && editable && !openedEditor.current) {
      openedEditor.current = true;
      setEditing(true);
    }
  }, [startEditing, editable]);
  useLayoutEffect(() => {
    if (!connection || !admitted || !notesLoaded) return;
    store.dispatch(selectNote(workspaceId, noteId));
    store.dispatch(noteContentViewRequested(consumerId, crypto.randomUUID(), workspaceId, noteId));
    return () => {
      store.dispatch(noteContentViewReleased(workspaceId, consumerId));
    };
  }, [consumerId, workspaceId, noteId, connection, admitted, notesLoaded]);
  const current = view.value?.noteId === noteId ? view.value : undefined;
  const ready = current?.status === 'ready' && current.authority === connection;
  const failed = current?.status === 'error' && current.authority === connection;
  useLayoutEffect(() => {
    if (ready && !editing) title.current?.focus();
    else if (failed) retry.current?.focus();
  }, [ready, failed, editing]);
  function openNote(targetWorkspaceId: string, targetNoteId: string) {
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: targetWorkspaceId },
      search: {
        note: targetNoteId,
        q: targetWorkspaceId === workspaceId ? query || undefined : undefined,
        fileQuery: targetWorkspaceId === workspaceId ? fileQuery || undefined : undefined,
      },
    });
  }
  function unsupportedLink() {
    setNavigationMessage(
      'This preview supports notes, workspace files and web links. Chat navigation is not connected yet.',
    );
  }
  function openFile(targetWorkspaceId: string, path: string, options?: { line?: number }) {
    const target = parseWorkspaceFileTarget(path);
    if (!target.valid) {
      setNavigationMessage(target.error ?? m.ui_linkHandler_invalidFilePath_error());
      return;
    }
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: targetWorkspaceId },
      search: {
        file: target.resourceId,
        line: options?.line,
        note: targetWorkspaceId === workspaceId ? noteId : undefined,
        q: targetWorkspaceId === workspaceId ? query || undefined : undefined,
        fileQuery: targetWorkspaceId === workspaceId ? fileQuery || undefined : undefined,
      },
    });
  }
  function openLink(url: string, options: LinkHandlerOptions): boolean {
    const target = options.rawHref ?? url;
    setNavigationMessage(null);
    if (target.startsWith('intent://')) {
      const link = parseIntentLink(target);
      if (!link.valid) {
        setNavigationMessage(link.error ?? 'This link is not valid.');
      } else if (link.type === 'note' || link.type === 'task') {
        openNote(link.workspaceId ?? workspaceId, link.resourceId);
      } else if (link.type === 'file') {
        openFile(link.workspaceId ?? workspaceId, link.resourceId, { line: link.line });
      } else {
        unsupportedLink();
      }
      return true;
    }
    if (/^https?:\/\//.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    }
    if (target.startsWith('#')) {
      document.getElementById(target.slice(1))?.scrollIntoView();
      return true;
    }
    unsupportedLink();
    return true;
  }
  return (
    <NoteContentSurface
      state={editing ? 'editor' : failed ? 'error' : !ready ? 'loading' : 'read-only'}
    >
      {failed && !editing ? (
        <div className="grid justify-items-start gap-4">
          <p role="alert">{current.error}</p>
          <Button
            ref={retry}
            variant="outline"
            onClick={() =>
              store.dispatch(
                noteContentViewRequested(consumerId, crypto.randomUUID(), workspaceId, noteId),
              )
            }
          >
            {m.ui_combobox_retry_label()}
          </Button>
        </div>
      ) : !ready && !editing ? (
        <LoadingState label="Loading note content" />
      ) : (
        <article className="grid min-w-0 gap-4" data-testid="workspace-note" data-note-id={noteId}>
          <header className="flex min-w-0 items-start gap-4">
            <h2 ref={title} tabIndex={-1} className="type-heading-sm min-w-0 flex-1">
              {connection ? note.value?.title : undefined}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={showSource}
              disabled={editing}
              onClick={() => setShowSource(!showSource)}
            >
              Source
            </Button>
            {editable && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {m.workspace_noteEdit_edit_label()}
              </Button>
            )}
          </header>
          <WorkspaceTaskStatus workspaceId={workspaceId} noteId={noteId} consumerId={consumerId} />
          {navigationMessage && (
            <output className="type-caption text-muted-foreground">{navigationMessage}</output>
          )}
          {editing ? (
            <WorkspaceNoteEditor
              workspaceId={workspaceId}
              noteId={noteId}
              consumerId={consumerId}
              onView={() => setEditing(false)}
            />
          ) : showSource ? (
            <pre
              className="min-w-0 whitespace-pre-wrap break-words font-sans"
              data-testid="note-content"
            >
              {note.value?.content}
            </pre>
          ) : (
            <div className="min-w-0" data-testid="note-rendered-content">
              <MarkdownViewer
                content={note.value?.content ?? ''}
                workspaceContext={{ workspaceId: WorkspaceId(workspaceId) }}
                canOpenFile={() => ready}
                allowFileMedia={false}
                canLoadMedia={(url) => /^(?:https?:|data:|blob:)/i.test(url.trim())}
                taskBlockRenderMode="content"
                renderRichFencesAsCode
                renderDiagrams
                forceExternalLinks
                onOpenLink={openLink}
                onOpenNote={openNote}
                onOpenFile={openFile}
              />
            </div>
          )}
        </article>
      )}
    </NoteContentSurface>
  );
}

export function WorkspaceNotes({
  workspaceId,
  noteId,
  query = '',
  fileQuery,
  onRetry,
}: {
  workspaceId: string;
  noteId?: string;
  query?: string;
  fileQuery?: string;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const state = selectWorkspaceNotesState(workspaceId);
  const notes = selectAllNotes(workspaceId);
  const [createdEditor, setCreatedEditor] = useState<string | null>(null);
  const filteredNotes = filterContextNotes(notes.value, query);
  const list = useRef<HTMLUListElement>(null);
  const filterHeader = useRef<HTMLElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const previousNoteId = useRef(noteId);
  const connection = authority.value;
  useLayoutEffect(() => {
    if (state.value.error) retry.current?.focus();
  }, [state.value.error]);
  useLayoutEffect(() => {
    const previous = previousNoteId.current;
    previousNoteId.current = noteId;
    if (!noteId && previous) {
      const opener = list.current?.querySelector<HTMLAnchorElement>(
        `a[data-note-id="${CSS.escape(previous)}"]`,
      );
      (opener ?? filterHeader.current?.querySelector<HTMLElement>('input, button'))?.focus();
    }
  }, [noteId]);
  if (!connection && !noteId) return <p>Notes are not available for the current connection.</p>;
  if (state.value.error && !noteId)
    return (
      <div className="grid justify-items-start gap-4">
        <p role="alert">{state.value.error}</p>
        <Button ref={retry} variant="outline" onClick={onRetry}>
          {m.ui_combobox_retry_label()}
        </Button>
      </div>
    );
  if (!state.value.initialized && !noteId) return <LoadingState label="Loading notes" />;
  return (
    <section className="grid min-w-0 gap-6" data-testid="workspace-notes">
      {noteId ? (
        <>
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId }}
            search={{ q: query || undefined, fileQuery: fileQuery || undefined }}
            className="w-fit text-muted-foreground hover:text-foreground"
          >
            All notes
          </Link>
          <NoteContent
            key={noteId}
            startEditing={createdEditor === noteId}
            workspaceId={workspaceId}
            noteId={noteId}
            query={query}
            fileQuery={fileQuery}
          />
        </>
      ) : (
        <>
          <header ref={filterHeader} className="flex min-w-0 items-center gap-4">
            <h2 className="type-heading-sm flex-1">Notes</h2>
            <WorkspaceNoteCreate
              workspaceId={workspaceId}
              onCreated={(createdId) => {
                setCreatedEditor(createdId);
                void navigate({
                  to: '/workspaces/$workspaceId',
                  params: { workspaceId },
                  search: {
                    note: createdId,
                    q: query || undefined,
                    fileQuery: fileQuery || undefined,
                  },
                });
              }}
            />
            <SidebarExpandableSearch
              query={query}
              onQueryChange={(value) => {
                void navigate({
                  to: '/workspaces/$workspaceId',
                  params: { workspaceId },
                  search: { q: value || undefined, fileQuery: fileQuery || undefined },
                  replace: true,
                });
              }}
              placeholder="Filter notes"
              scope="context"
            />
          </header>
          {filteredNotes.length === 0 && (
            <output className="text-muted-foreground">
              {notes.value.length === 0
                ? m.notes_panel_empty_label()
                : m.onboarding_dirPicker_noSearchResults_description()}
            </output>
          )}
          <ul ref={list} className="grid gap-1">
            {filteredNotes.map((note) => (
              <li key={note.id}>
                <Link
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId }}
                  search={{
                    note: String(note.id),
                    q: query || undefined,
                    fileQuery: fileQuery || undefined,
                  }}
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

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

function NoteContent({
  workspaceId,
  noteId,
  query,
}: {
  workspaceId: string;
  noteId: string;
  query: string;
}) {
  const consumerId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const [showSource, setShowSource] = useState(false);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
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
  useLayoutEffect(() => {
    if (ready) title.current?.focus();
  }, [ready]);
  function openNote(targetWorkspaceId: string, targetNoteId: string) {
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: targetWorkspaceId },
      search: {
        note: targetNoteId,
        q: targetWorkspaceId === workspaceId ? query || undefined : undefined,
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
    <NoteContentSurface state={failed ? 'error' : !ready ? 'loading' : 'read-only'}>
      {failed ? (
        <p role="alert">{current.error}</p>
      ) : !ready ? (
        <LoadingState label="Loading note content" />
      ) : (
        <article className="grid min-w-0 gap-4" data-testid="workspace-note" data-note-id={noteId}>
          <header className="flex min-w-0 items-start gap-4">
            <h2 ref={title} tabIndex={-1} className="type-heading-sm min-w-0 flex-1">
              {note.value?.title}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={showSource}
              onClick={() => setShowSource(!showSource)}
            >
              Source
            </Button>
          </header>
          {navigationMessage && (
            <output className="type-caption text-muted-foreground">{navigationMessage}</output>
          )}
          {showSource ? (
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
}: {
  workspaceId: string;
  noteId?: string;
  query?: string;
}) {
  const navigate = useNavigate();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const state = selectWorkspaceNotesState(workspaceId);
  const notes = selectAllNotes(workspaceId);
  const filteredNotes = filterContextNotes(notes.value, query);
  const list = useRef<HTMLUListElement>(null);
  const filterHeader = useRef<HTMLElement>(null);
  const previousNoteId = useRef(noteId);
  const connection = authority.value;
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
            search={{ q: query || undefined }}
            className="w-fit text-muted-foreground hover:text-foreground"
          >
            All notes
          </Link>
          <NoteContent key={noteId} workspaceId={workspaceId} noteId={noteId} query={query} />
        </>
      ) : (
        <>
          <header ref={filterHeader} className="flex min-w-0 items-center gap-4">
            <h2 className="type-heading-sm flex-1">Notes</h2>
            <SidebarExpandableSearch
              query={query}
              onQueryChange={(value) => {
                void navigate({
                  to: '/workspaces/$workspaceId',
                  params: { workspaceId },
                  search: { q: value || undefined },
                  replace: true,
                });
              }}
              placeholder="Filter notes"
              scope="context"
            />
          </header>
          {filteredNotes.length === 0 && (
            <output className="text-muted-foreground">
              {m.onboarding_dirPicker_noSearchResults_description()}
            </output>
          )}
          <ul ref={list} className="grid gap-1">
            {filteredNotes.map((note) => (
              <li key={note.id}>
                <Link
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId }}
                  search={{ note: String(note.id), q: query || undefined }}
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

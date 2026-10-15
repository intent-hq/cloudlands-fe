import { useLayoutEffect, useRef, useState } from 'react';
import { MarkdownViewer } from '@/components/markdown/markdown-viewer';
import { NoteContentSurface } from '@/features/layout/tab-types/note-content-surface';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import {
  selectNoteById,
  selectNoteContentView,
  selectWorkspaceNotesState,
} from '@/store/workspace-notes/workspace-notes-selectors';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  noteContentViewRequested,
  noteContentViewReleased,
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { saveScrollPosition } from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import { openTab } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import { parseIntentLink } from '$shared/utils/intent-link-parser';
import { m } from '$shared/paraglide/messages.js';

/** Source RenderedNotePreview; rich editing is a separate, explicitly unported inner view. */
export function DesktopNotePreview({
  workspaceId,
  noteId,
  tabId,
}: {
  workspaceId: string;
  noteId: string;
  tabId: string;
}) {
  const [consumerId] = useState(() => crypto.randomUUID());
  const note = selectNoteById(workspaceId, noteId).value;
  const view = selectNoteContentView(workspaceId, consumerId).value;
  const initialized = selectWorkspaceNotesState(workspaceId).value.initialized;
  const context = selectPrincipalConnectionContext().value;
  const admitted = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const host = useRef<HTMLElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!context || !admitted || !initialized) return;
    store.dispatch(noteContentViewRequested(consumerId, crypto.randomUUID(), workspaceId, noteId));
    return () => {
      store.dispatch(noteContentViewReleased(workspaceId, consumerId));
    };
  }, [workspaceId, noteId, consumerId, context, admitted, initialized]);
  const ready = view?.status === 'ready' && view.authority === context && view.noteId === noteId;
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const position = store.state.tabState.scrollPositions[tabId] ?? 0;
    let pending = position;
    const restore = () => {
      if (pending && element.scrollHeight - element.clientHeight >= pending) {
        element.scrollTop = pending;
        pending = 0;
      }
    };
    const observer = new ResizeObserver(restore);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    restore();
    const cancel = () => {
      pending = 0;
    };
    element.addEventListener('wheel', cancel, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', cancel);
      store.dispatch(saveScrollPosition(tabId, pending || element.scrollTop));
    };
  }, [tabId, note?.content, ready]);

  const failed = view?.status === 'error' && view.authority === context;
  function openNote(ws: string, id: string) {
    if (
      ws !== workspaceId ||
      selectAdmittedWorkspaceReadContext.select(store.state, ws) !== admitted
    ) {
      setMessage(m.desktop_shell_unported_description());
      return;
    }
    const target = selectNoteById.select(store.state, ws, id);
    if (!target) {
      setMessage(m.layout_noteTab_contentLoadFailed_error());
      return;
    }
    store.dispatch(
      openTab(ws, {
        type: 'note',
        noteId: id,
        workspaceId: ws,
        title: target.title,
        closable: true,
      }),
    );
  }
  return (
    <NoteContentSurface state={failed ? 'error' : ready ? 'read-only' : 'loading'}>
      {failed ? (
        <div role="alert" className="p-6">
          <p>{m.layout_noteTab_contentLoadFailed_error()}</p>
          <Button
            variant="outline"
            onClick={() =>
              store.dispatch(
                noteContentViewRequested(consumerId, crypto.randomUUID(), workspaceId, noteId),
              )
            }
          >
            {m.ui_errorToast_retry_label()}
          </Button>
        </div>
      ) : !ready ? (
        <output className="p-6 text-subtle">
          {m.workspace_noteVersionHistory_loading_label()}
        </output>
      ) : (
        <section
          ref={host}
          className="rendered-note-preview h-full min-h-0 overflow-y-auto"
          role="document"
          aria-label={m.layout_noteTab_renderedPreview_ariaLabel()}
          data-testid="rendered-note-preview"
        >
          <div className="mx-auto w-full max-w-4xl px-6 pb-32 pt-6">
            {message && <output>{message}</output>}
            <MarkdownViewer
              content={note?.content ?? ''}
              workspaceContext={{ workspaceId: WorkspaceId(workspaceId) }}
              workspaceId={workspaceId}
              taskBlockRenderMode="content"
              renderRichFencesAsCode
              renderDiagrams
              allowFileMedia={false}
              onOpenNote={openNote}
              onOpenFile={() => setMessage(m.desktop_shell_unported_description())}
              onOpenLink={(url, options) => {
                const target = options.rawHref ?? url;
                if (target.startsWith('intent://')) {
                  const link = parseIntentLink(target);
                  if (link.valid && (link.type === 'note' || link.type === 'task'))
                    openNote(link.workspaceId ?? workspaceId, link.resourceId);
                  else setMessage(m.desktop_shell_unported_description());
                  return true;
                }
                if (/^https?:\/\//.test(target)) {
                  window.open(target, '_blank', 'noopener,noreferrer');
                  return true;
                }
                if (target.startsWith('#')) {
                  host.current
                    ?.querySelector<HTMLElement>(`#${CSS.escape(target.slice(1))}`)
                    ?.scrollIntoView();
                  return true;
                }
                return false;
              }}
            />
          </div>
        </section>
      )}
    </NoteContentSurface>
  );
}

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { CodeEditor } from '@/components/editor/code-editor';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import { selectCodeFontFamilyCSS } from '@/store/user-preferences/user-preferences-selectors';
import {
  selectExplicitNoteEditor,
  selectExplicitNoteEditorCurrent,
  selectNoteEditorState,
  selectNoteEditReady,
  selectNoteEditAuthority,
  selectNoteEditContext,
} from '@/store/workspace-notes/note-edit-selectors';
import {
  explicitNoteEditorOpened,
  explicitNoteEditorRebound,
  explicitNoteEditorReleased,
  explicitNoteDraftChanged,
  explicitNoteSaveRequested,
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceUnsavedNavigation } from './workspace-unsaved-navigation';

/** The editor owns its model and view token; content, base revision and outcomes remain canonical. */
export function WorkspaceNoteEditor({
  workspaceId,
  noteId,
  consumerId,
  onView,
}: {
  workspaceId: string;
  noteId: string;
  consumerId: string;
  onView: () => void;
}) {
  const editorHost = useRef<HTMLDivElement>(null);
  const dark = selectIsDarkTheme().value;
  const fontFamily = selectCodeFontFamilyCSS().value;
  const authority = selectNoteEditAuthority(workspaceId, noteId).value;
  const context = selectNoteEditContext(workspaceId, noteId).value;
  const initial = useRef({ authority, context });
  const [viewId, setViewId] = useState('');
  const editor = selectExplicitNoteEditor(viewId).value;
  const ready = selectNoteEditReady(workspaceId, noteId, consumerId).value;
  const { dirty, bounded, pending, uncertain, blocked, last } = selectNoteEditorState(viewId).value;
  useLayoutEffect(() => {
    const { authority, context } = initial.current;
    if (!authority || !context) return;
    const id = crypto.randomUUID();
    setViewId(id);
    store.dispatch(
      explicitNoteEditorOpened({ workspaceId, noteId, viewId: id, authority, context }),
    );
    return () => {
      store.dispatch(explicitNoteEditorReleased(id));
    };
  }, [workspaceId, noteId]);
  useLayoutEffect(() => {
    if (
      editor &&
      !editor.retired &&
      ready &&
      authority === editor.authority &&
      context &&
      editor.context !== context
    )
      store.dispatch(
        explicitNoteEditorRebound({ workspaceId, noteId, viewId, authority, context }),
      );
  }, [editor, ready, authority, context, workspaceId, noteId, viewId]);
  const isCurrent = useCallback(() => {
    return (
      !!editor &&
      selectExplicitNoteEditorCurrent.select(store.state, editor) &&
      selectNoteEditReady.select(store.state, workspaceId, noteId, consumerId) &&
      selectNoteEditAuthority.select(store.state, workspaceId, noteId) === editor.authority &&
      selectNoteEditContext.select(store.state, workspaceId, noteId) === editor.context
    );
  }, [editor, workspaceId, noteId, consumerId]);
  const navigationCurrent = useCallback(
    () =>
      !!editor &&
      selectExplicitNoteEditorCurrent.select(store.state, editor) &&
      (!selectNoteEditAuthority.select(store.state, workspaceId, noteId) ||
        selectNoteEditAuthority.select(store.state, workspaceId, noteId) === editor.authority),
    [editor, workspaceId, noteId],
  );
  useLayoutEffect(() => {
    if (editor && authority && authority !== editor.authority)
      store.dispatch(explicitNoteEditorReleased(viewId));
  }, [editor, authority, viewId]);
  const readProtection = useCallback(() => {
    const current = selectExplicitNoteEditor.select(store.state, viewId);
    const state = selectNoteEditorState.select(store.state, viewId);
    return {
      snapshot: current,
      dirty: state.dirty,
      pending: state.pending,
      uncertain: state.uncertain,
    };
  }, [viewId]);
  const isSameResource = useCallback(
    ({ current, next }: Parameters<ShouldBlockFn>[0]) => {
      const search = next.search as Record<string, unknown>;
      return (
        current.pathname === next.pathname &&
        search.note === noteId &&
        !search.file &&
        !search.agent &&
        !search.diff &&
        !search.attachment &&
        !search.attachmentAgent
      );
    },
    [noteId],
  );
  const save = () => {
    if (!editor || !dirty || !bounded || blocked || !isCurrent()) return;
    store.dispatch(
      explicitNoteSaveRequested({
        workspaceId,
        noteId,
        viewId,
        authority: editor.authority,
        context: editor.context,
        draftSeq: editor.draftSeq,
        requestId: crypto.randomUUID(),
      }),
    );
  };
  if (!editor || editor.retired)
    return <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />;
  const guard = (
    <WorkspaceUnsavedNavigation
      context={editor.authority}
      snapshot={editor}
      pendingSave={pending}
      uncertain={uncertain}
      isCurrent={navigationCurrent}
      readProtection={readProtection}
      isSameResource={isSameResource}
      editorHost={editorHost}
      title={m.workspace_noteEdit_leave_label()}
      description={m.workspace_noteEdit_discard_description()}
    />
  );
  if (authority !== editor.authority)
    return (
      <>
        {guard}
        <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />
      </>
    );
  return (
    <div
      ref={editorHost}
      className="grid min-w-0 gap-3"
      data-testid="workspace-note-editor"
      data-note-dirty={dirty}
    >
      {guard}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={save}
          disabled={!dirty || !bounded || blocked || !isCurrent()}
          data-testid="workspace-note-save"
        >
          {pending ? m.workspace_fileEdit_saving_label() : m.workspace_fileEdit_save_label()}
        </Button>
        <Button
          variant="outline"
          disabled={dirty || pending || uncertain}
          onClick={() => {
            const current = selectNoteEditorState.select(store.state, viewId);
            if (isCurrent() && !current.dirty && !current.pending && !current.uncertain) onView();
          }}
        >
          {m.workspace_noteEdit_view_label()}
        </Button>
        <output>
          {dirty
            ? m.workspace_fileEdit_unsaved_label()
            : last?.status === 'confirmed'
              ? m.workspace_fileEdit_saved_label()
              : ''}
        </output>
      </div>
      <p className="type-caption text-muted-foreground">
        {m.workspace_noteEdit_explicit_description()}
      </p>
      {uncertain && <p role="alert">{m.workspace_noteEdit_uncertain_error()}</p>}
      {last?.status === 'failed' && (
        <p role="alert">{last.error ?? m.notes_writeService_saveFailed_error()}</p>
      )}
      {!bounded && <p role="alert">{m.workspace_noteEdit_bounded_error()}</p>}
      <CodeEditor
        value={editor.content}
        path={`note/${workspaceId}/${noteId}.md`}
        language="markdown"
        dark={dark}
        fontFamily={fontFamily}
        readOnly={!isCurrent()}
        ariaLabel={m.workspace_noteEdit_editor_ariaLabel()}
        errorLabel={m.workspace_noteEdit_editorFailed_error()}
        onSave={save}
        onChange={(content) => {
          if (isCurrent()) store.dispatch(explicitNoteDraftChanged(viewId, content));
        }}
      />
    </div>
  );
}

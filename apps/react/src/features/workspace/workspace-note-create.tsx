import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/patterns/form';
import { FormDialog } from '@/components/patterns/confirm';
import { store } from '@/store';
import { m } from '$shared/paraglide/messages.js';
import {
  selectNoteCreateAuthority,
  selectNoteCreateContext,
  selectExplicitNoteCreatorCurrent,
  selectNoteCreationState,
} from '@/store/workspace-notes/note-create-selectors';
import {
  createNotePersistRequested,
  explicitNoteCreatorOpened,
  explicitNoteCreatorReleased,
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';

function CreateForm({
  workspaceId,
  authority,
  context,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  authority: string;
  context: string;
  onClose: () => void;
  onCreated: (noteId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const view = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const state = selectNoteCreationState(workspaceId).value;
  const liveContext = selectNoteCreateContext(workspaceId).value;
  useLayoutEffect(() => {
    const viewId = crypto.randomUUID();
    view.current = viewId;
    store.dispatch(explicitNoteCreatorOpened({ workspaceId, viewId, authority, context }));
    return () => {
      view.current = null;
      store.dispatch(explicitNoteCreatorReleased(viewId));
    };
  }, [workspaceId, authority, context]);
  function close() {
    const viewId = view.current;
    view.current = null;
    if (viewId) store.dispatch(explicitNoteCreatorReleased(viewId));
    onClose();
  }
  return (
    <FormDialog
      open
      title={m.workspace_noteCreate_new_label()}
      submitLabel={m.workspace_noteCreate_create_label()}
      initialFocus={input}
      submitBusy={state.pending}
      canSubmit={!!title.trim() && !state.blocked && liveContext === context}
      cancelLabel={state.pending || state.unknown ? m.ui_dialog_close_ariaLabel() : undefined}
      onCancel={close}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onSubmit={() => {
        const viewId = view.current;
        if (!viewId || !title.trim()) return;
        const identity = {
          workspaceId,
          viewId,
          authority,
          context,
          requestId: crypto.randomUUID(),
        };
        const current = () =>
          view.current === viewId &&
          selectExplicitNoteCreatorCurrent.select(store.state, identity) &&
          selectNoteCreateContext.select(store.state, workspaceId) === context &&
          selectNoteCreateAuthority.select(store.state, workspaceId) === authority;
        if (!current() || selectNoteCreationState.select(store.state, workspaceId).blocked) return;
        // The canonical owner retains failures/unknown outcomes; only a live form may navigate.
        void store
          .dispatch(
            createNotePersistRequested(
              workspaceId,
              { title: title.trim(), content: '', tags: [] },
              identity,
            ),
          )
          .then((noteId) => {
            if (!noteId || !current()) return;
            onCreated(noteId);
            close();
          })
          .catch(() => undefined);
      }}
    >
      <FormField
        label={m.workspace_noteCreate_title_label()}
        required
        control={(props) => (
          <Input
            {...props}
            ref={input}
            value={title}
            disabled={state.pending || state.unknown}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      />
      {state.pending && <output>{m.workspace_noteCreate_pending_description()}</output>}
      {state.unknown && <p role="alert">{m.workspace_noteCreate_unknown_description()}</p>}
      {state.last?.status === 'failed' && (
        <p role="alert">{m.workspace_noteCreate_failed_description()}</p>
      )}
      {liveContext !== context && (
        <p role="alert">{m.workspace_noteCreate_retired_description()}</p>
      )}
    </FormDialog>
  );
}

export function WorkspaceNoteCreate({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (noteId: string) => void;
}) {
  const authority = selectNoteCreateAuthority(workspaceId).value;
  const context = selectNoteCreateContext(workspaceId).value;
  const state = selectNoteCreationState(workspaceId).value;
  const [form, setForm] = useState<{ authority: string; context: string } | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!context || state.blocked}
        onClick={() => {
          const currentAuthority = selectNoteCreateAuthority.select(store.state, workspaceId);
          const currentContext = selectNoteCreateContext.select(store.state, workspaceId);
          if (
            currentAuthority &&
            currentContext &&
            !selectNoteCreationState.select(store.state, workspaceId).blocked
          )
            setForm({ authority: currentAuthority, context: currentContext });
        }}
      >
        {m.workspace_noteCreate_new_label()}
      </Button>
      {form && form.authority === authority && (
        <CreateForm
          workspaceId={workspaceId}
          {...form}
          onClose={() => setForm(null)}
          onCreated={onCreated}
        />
      )}
      {!form && state.pending && <output>{m.workspace_noteCreate_pending_description()}</output>}
      {!form && state.unknown && <p role="alert">{m.workspace_noteCreate_unknown_description()}</p>}
    </>
  );
}

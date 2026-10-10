<script lang="ts">
  import { startWorkspaceNotesSagaFixture } from '../../../../test/fixtures/workspace-notes-saga-fixture';
  import { onDestroy } from 'svelte';
  import { reserveNoteDeleteDraft } from '$features/notes/note-delete-gate';
  import { Button } from '$lib/components/ui/button';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    loadWorkspaceNotesSucceeded,
    noteDeleteViewChanged,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import NoteWithComments from '../NoteWithComments.svelte';
  import type { Workspace } from '$shared/types';
  import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  let {
    initialContent = '# Original',
    preferRaw = false,
    editable = true,
    holdSaves = false,
    initiallyAnonymous = false,
    initialInstanceId,
    recoveryCapacityFull = false,
  } = $props<{
    initialContent?: string;
    preferRaw?: boolean;
    editable?: boolean;
    holdSaves?: boolean;
    initiallyAnonymous?: boolean;
    initialInstanceId?: string;
    recoveryCapacityFull?: boolean;
  }>();

  const workspaceId = 'full-note-ct';
  const persistedNoteId = 'raw-note';
  let noteId = $state<string | undefined>(initiallyAnonymous ? undefined : persistedNoteId);
  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => startWorkspaceNotesSagaFixture(store),
  });
  let visible = $state(true);
  let editor: { finishEditing(): Promise<void> };
  let resolveSave: (() => void) | undefined, rejectSave: (() => void) | undefined;
  let finishError = $state(false);
  async function done() {
    try {
      await editor.finishEditing();
      visible = false;
    } catch {
      finishError = true;
    }
  }
  let persisted = $state(initialContent);
  let requests = $state<unknown[]>([]);
  let rev = 4;
  const initialNote: Note = {
    id: NoteId(persistedNoteId),
    workspaceId: WorkspaceId(workspaceId),
    title: 'Raw note',
    content: initialContent,
    rev,
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    tags: [],
    isPinned: false,
    isArchived: false,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
  };
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [initialNote] }));

  const workspace = { id: WorkspaceId(workspaceId), title: 'Full note' } as Workspace;
  store.dispatch(setNoteViewMode(workspaceId, persistedNoteId, preferRaw ? 'raw' : 'editor'));
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Browser test installs a mock daemon boundary; production writes use the real service.
  installMockElectronBridge({
    'note.get': () => ({ ...initialNote, content: persisted, rev }),
    'note.update': async (params) => {
      requests = [...requests, params];
      if (holdSaves)
        await new Promise<void>((resolve, reject) => {
          resolveSave = resolve;
          rejectSave = () => reject(new Error('Save acknowledgement lost'));
        });
      if ((params as { expectedVersion: number }).expectedVersion !== rev)
        throw new Error('Conflict');
      persisted = (params as { content: string }).content;
      return { ...initialNote, content: persisted, rev: ++rev };
    },
  });
  function updateExternally() {
    persisted = '# External';
    store.dispatch(
      loadWorkspaceNotesSucceeded([workspaceId], {
        [workspaceId]: [{ ...initialNote, content: persisted, rev: ++rev }],
      }),
    );
  }
  const reservations: Array<() => void> = [];
  if (recoveryCapacityFull) {
    for (let i = 0; i < 256; i++) {
      const release = reserveNoteDeleteDraft({
        backendGeneration: store.state.daemonHealth.connectionGeneration,
        workspaceId,
        noteId: `reserved-${i}`,
        ownerId: `capacity-${i}`,
      });
      if (!release) throw new Error(`Recovery fixture could not reserve slot ${i}`);
      reservations.push(release);
    }
  }
  function holdPersistedNote() {
    store.dispatch(
      noteDeleteViewChanged({
        backendGeneration: store.state.daemonHealth.connectionGeneration,
        workspaceId,
        noteId: persistedNoteId,
        owner: 'anonymous-compatibility-fixture',
        phase: 'uncertain',
        held: true,
        hidden: false,
        canCancel: false,
      }),
    );
  }
  onDestroy(() => {
    reservations.splice(0).forEach((release) => release());
    dispose();
  });
</script>

<div class="flex h-[600px] flex-col">
  <div>
    <Button onclick={() => (visible = !visible)}>Toggle editor</Button>
    <Button onclick={() => (noteId = persistedNoteId)}>Assign note ID</Button>
    <Button onclick={() => (noteId = 'other-note')}>Assign another note ID</Button>
    <Button onclick={() => (noteId = undefined)}>Remove note ID</Button>
    <Button onclick={() => reservations.pop()?.()}>Release recovery slot</Button>
    <Button onclick={holdPersistedNote}>Hold persisted note</Button>
    <Button onclick={updateExternally}>External update</Button>
    <Button onclick={done}>Done editing</Button>
    <Button onclick={() => resolveSave?.()}>Accept save</Button>
    <Button onclick={() => rejectSave?.()}>Reject save</Button>
    {#if finishError}<span data-testid="finish-error">Draft retained</span>{/if}
  </div>
  {#if visible}
    <NoteWithComments
      bind:this={editor}
      {workspace}
      {noteId}
      noteInstanceId={initialInstanceId}
      content={initialContent}
      {editable}
      showComments={false}
      isPanelFocused={true}
    />
  {/if}
  <output data-testid="persisted"
    >{JSON.stringify({
      length: persisted.length,
      start: persisted.slice(0, 30),
      end: persisted.slice(-30),
    })}</output
  >
  <output data-testid="requests"
    >{JSON.stringify(
      requests.map((r) => {
        const p = r as { content: string; expectedVersion: number };
        return {
          length: p.content.length,
          start: p.content.slice(0, 30),
          end: p.content.slice(-30),
          rev: p.expectedVersion,
        };
      }),
    )}</output
  >
</div>

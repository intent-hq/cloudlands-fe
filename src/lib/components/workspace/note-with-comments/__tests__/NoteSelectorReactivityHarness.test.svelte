<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import type { Store } from '@augmentcode/themis/svelte-store';
  import {
    selectAllNotes,
    selectNoteById,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import type { Note } from '$shared/types';

  let {
    store,
    workspaceId,
    noteId,
    notesByWorkspace,
  }: {
    store: Store<any, any>;
    workspaceId: string | null;
    noteId: string | null;
    notesByWorkspace: Record<string, Note[]>;
  } = $props();

  const workspaceId$ = writable<string | null>(null);
  const noteId$ = writable<string | null>(null);

  function initStore() {
    return store.init();
  }

  function createSelectedNoteReadable() {
    return selectNoteById.withStore(store)(workspaceId$, noteId$);
  }

  function createAllNotesReadable() {
    return selectAllNotes.withStore(store)(workspaceId$);
  }

  function dispatchNotes() {
    store.dispatch(loadWorkspaceNotesSucceeded(Object.keys(notesByWorkspace), notesByWorkspace));
  }

  const dispose = initStore();
  const selectedNote$ = createSelectedNoteReadable();
  const allNotes$ = createAllNotesReadable();

  $effect(() => {
    dispatchNotes();
    workspaceId$.set(workspaceId);
    noteId$.set(noteId);
  });

  const selectedFromState = $derived($selectedNote$);
  const noteCount = $derived($allNotes$.length);

  onDestroy(() => {
    dispose();
  });
</script>

<div data-testid="selected-note-id">{$selectedNote$?.id ?? ''}</div>
<div data-testid="selected-note-content">{$selectedNote$?.content ?? ''}</div>
<div data-testid="selected-from-state-id">{selectedFromState?.id ?? ''}</div>
<div data-testid="readable-note-count">{noteCount}</div>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import RawNoteCodeEditor from '../RawNoteCodeEditor.svelte';

  const workspaceId = 'raw-note-ct';
  const noteId = 'raw-note';
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  let visible = $state(true);
  let persisted = $state('# Original');
  let requests = $state<unknown[]>([]);
  let rev = 4;
  const initialNote: Note = {
    id: NoteId(noteId),
    workspaceId: WorkspaceId(workspaceId),
    title: 'Raw note',
    content: '# Original',
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
  const note = selectNoteById(workspaceId, noteId);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Browser test installs a mock daemon boundary; production writes use the real service.
  installMockElectronBridge({
    'note.setContent': (params) => {
      requests = [...requests, params];
      const oldContent = persisted;
      persisted = (params as { content: string }).content;
      return {
        ok: true,
        noteId,
        title: initialNote.title,
        updatedAt: initialNote.updatedAt,
        oldContent,
        newContent: persisted,
        rev: ++rev,
        convertedCount: 0,
        createdTaskNoteIds: [],
        createdTasks: [],
        warnings: [],
      };
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
  onDestroy(dispose);
</script>

<div class="flex h-[600px] flex-col">
  <div>
    <Button onclick={() => (visible = !visible)}>Toggle editor</Button>
    <Button onclick={updateExternally}>External update</Button>
  </div>
  {#if visible}
    <RawNoteCodeEditor {workspaceId} {noteId} content={$note?.content ?? ''} rev={$note?.rev} />
  {/if}
  <pre data-testid="persisted">{persisted}</pre>
  <pre data-testid="requests">{JSON.stringify(requests)}</pre>
</div>

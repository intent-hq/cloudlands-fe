<script lang="ts">
  import { onDestroy } from 'svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';

  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { updateNoteContent } from '$features/notes/notes-write-service';
  import { selectLineWrapping } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    noteId: string;
    content: string;
    /** Daemon rev of `content`; the base a draft typed on it is saved against. */
    rev?: number;
    editable?: boolean;
    isPanelFocused?: boolean;
  }

  let {
    workspaceId,
    noteId,
    content,
    rev,
    editable = true,
    isPanelFocused = false,
  }: Props = $props();

  const lineWrapping = selectLineWrapping();
  const currentContent = $derived(content ?? '');
  const noteFilePath = $derived(`.workspace/notes/${noteId}.md`);

  interface PendingRawSave {
    workspaceId: string;
    noteId: string;
    content: string;
    // The text the draft was typed on: the last text synced from the store or
    // sent to the write service. Also the draft's content baseline, so edits
    // typed before a superseded echo rebased the in-flight draft are replayed
    // onto it instead of reading as a deletion of the echoed change.
    lastSavedContent: string;
    baseRev: number | undefined;
  }

  function getInitialContent(): string {
    return content ?? '';
  }

  function getInitialWorkspaceId(): string {
    return workspaceId;
  }

  function getInitialNoteId(): string {
    return noteId;
  }

  function getInitialRev(): number | undefined {
    return rev;
  }

  let editorContent = $state(getInitialContent());
  let lastSavedContent = getInitialContent();
  // Rev of the store text the editor last synced from. A draft is saved
  // against it, not against the store rev at send time: a note:updated refetch
  // during the save debounce advances the store past the text the user typed
  // on, and naming that newer rev would make the daemon overwrite its change
  // instead of merging.
  let editorContentRev = getInitialRev();
  let editorContentWorkspaceId = getInitialWorkspaceId();
  let editorContentNoteId = getInitialNoteId();
  let isUserEditing = $state(false);
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let userEditingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRawSave: PendingRawSave | null = null;

  $effect(() => {
    const latestContent = currentContent;
    const latestRev = rev;
    if (isUserEditing) return;
    if (latestContent !== editorContent) {
      editorContent = latestContent;
      lastSavedContent = latestContent;
      editorContentWorkspaceId = workspaceId;
      editorContentNoteId = noteId;
    }
    editorContentRev = latestRev;
  });

  function getNoteContentForEditor(): string {
    return editorContent;
  }

  function setNoteContentFromEditor(nextContent: string): void {
    editorContent = nextContent;
    editorContentWorkspaceId = workspaceId;
    editorContentNoteId = noteId;
    if (!editable) return;

    isUserEditing = true;
    if (userEditingTimer) clearTimeout(userEditingTimer);
    userEditingTimer = setTimeout(() => {
      isUserEditing = false;
    }, 1000);

    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    const pendingSave = createPendingRawSave(nextContent);
    pendingRawSave = pendingSave;
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null;
      saveRawContent(pendingSave);
    }, 1000);
  }

  function createPendingRawSave(nextContent = editorContent): PendingRawSave {
    return {
      workspaceId,
      noteId,
      content: nextContent,
      lastSavedContent,
      baseRev: editorContentRev,
    };
  }

  function saveRawContent(target = createPendingRawSave(), immediate = false): void {
    if (pendingRawSave === target) pendingRawSave = null;
    if (!target.workspaceId || !target.noteId || target.content === target.lastSavedContent) return;

    const note = selectNoteById.select(appStore.state, target.workspaceId, target.noteId);
    if (!note) return;

    if (target.workspaceId === workspaceId && target.noteId === noteId) {
      lastSavedContent = target.content;
    }
    // eslint-disable-next-line intent/no-component-async-data-fetch -- sanctioned post-saga notes-write-service seam (dispatches optimistic store updates + AppClient mutation); not a component data fetch.
    updateNoteContent(target.workspaceId, target.noteId, target.content, {
      immediate,
      baseRev: target.baseRev,
      baseContent: target.lastSavedContent,
    });
  }

  export function flushPendingSave(): void {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    if (pendingRawSave) {
      saveRawContent(pendingRawSave, true);
      return;
    }
    if (editorContentWorkspaceId === workspaceId && editorContentNoteId === noteId) {
      saveRawContent(createPendingRawSave(), true);
    }
  }

  onDestroy(() => {
    if (userEditingTimer) clearTimeout(userEditingTimer);
    flushPendingSave();
  });
</script>

<div class="flex-1 min-h-0 w-full" data-testid="raw-note-view">
  <CodeEditor
    bind:value={getNoteContentForEditor, setNoteContentFromEditor}
    language="markdown"
    readOnly={!editable}
    fileName={noteFilePath}
    {workspaceId}
    filePath={noteFilePath}
    lineWrapping={$lineWrapping}
    {isPanelFocused}
  />
</div>

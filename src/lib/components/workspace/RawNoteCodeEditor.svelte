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
    editable?: boolean;
    isPanelFocused?: boolean;
  }

  let { workspaceId, noteId, content, editable = true, isPanelFocused = false }: Props = $props();

  const lineWrapping = selectLineWrapping();
  const currentContent = $derived(content ?? '');
  const noteFilePath = $derived(`.workspace/notes/${noteId}.md`);

  interface PendingRawSave {
    workspaceId: string;
    noteId: string;
    content: string;
    lastSavedContent: string;
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

  let editorContent = $state(getInitialContent());
  let lastSavedContent = getInitialContent();
  let editorContentWorkspaceId = getInitialWorkspaceId();
  let editorContentNoteId = getInitialNoteId();
  let isUserEditing = $state(false);
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let userEditingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRawSave: PendingRawSave | null = null;

  $effect(() => {
    const latestContent = currentContent;
    if (!isUserEditing && latestContent !== editorContent) {
      editorContent = latestContent;
      lastSavedContent = latestContent;
      editorContentWorkspaceId = workspaceId;
      editorContentNoteId = noteId;
    }
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
    };
  }

  function saveRawContent(target = createPendingRawSave(), immediate = false): void {
    if (pendingRawSave === target) pendingRawSave = null;
    if (!target.workspaceId || !target.noteId || target.content === target.lastSavedContent) return;

    const note = selectNoteById.select(
      appStore.state,
      target.workspaceId,
      target.noteId,
    );
    if (!note) return;

    if (target.workspaceId === workspaceId && target.noteId === noteId) {
      lastSavedContent = target.content;
    }
    updateNoteContent(target.workspaceId, target.noteId, target.content, { immediate });
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

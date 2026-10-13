<script lang="ts">
  import { subscribeNoteContentFailure } from '$features/notes/notes-write-service';
  import { onDestroy } from 'svelte';
  import {
    isNoteDeleteHeld,
    subscribeNoteDeleteHold,
    retainNoteDeleteDraft,
    reserveNoteDeleteDraft,
    notifyNoteDeleteInput,
  } from '$features/notes/note-delete-gate';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';

  import {
    selectNoteById,
    selectHasPendingNoteContent,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    settleNoteContentRequested,
    updateNoteContent,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { selectLineWrapping } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    noteId: string;
    content: string;
    /** Daemon rev of `content`; the base a draft typed on it is saved against. */
    rev?: number;
    initialDraft?: {
      content: string;
      baseContent: string;
      rev?: number;
      selection: { anchor: number; head: number };
    };
    editable?: boolean;
    isPanelFocused?: boolean;
    onDeleteInput?: () => void;
    deleteHeld?: boolean;
    recoveryOwnerId?: string;
    recoveryAdmitted?: boolean;
  }

  let {
    workspaceId,
    noteId,
    content,
    rev,
    initialDraft,
    editable = true,
    isPanelFocused = false,
    onDeleteInput,
    deleteHeld = false,
    recoveryOwnerId,
    recoveryAdmitted = false,
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
    return initialDraft?.content ?? content ?? '';
  }

  function getInitialWorkspaceId(): string {
    return workspaceId;
  }

  function getInitialNoteId(): string {
    return noteId;
  }

  function getInitialRev(): number | undefined {
    return initialDraft?.rev ?? rev;
  }

  // svelte-ignore state_referenced_locally -- inherited recovery owner is stable for the keyed raw editor lifetime
  const ownerId = recoveryOwnerId ?? crypto.randomUUID();
  const backendGeneration = appStore.state.daemonHealth?.connectionGeneration ?? 0;
  const recoveryScope = {
    backendGeneration,
    workspaceId: getInitialWorkspaceId(),
    noteId: getInitialNoteId(),
    ownerId,
  };
  // svelte-ignore state_referenced_locally -- standalone editors own their reservation; nested raw inherits its rich owner slot
  let releaseRecoveryReservation = recoveryOwnerId
    ? undefined
    : reserveNoteDeleteDraft(recoveryScope);
  let locallyAdmitted = $state(!!releaseRecoveryReservation);
  const hasRecoveryReservation = $derived(recoveryOwnerId ? recoveryAdmitted : locallyAdmitted);
  const ownsRecoveryBinding = $derived(
    workspaceId === recoveryScope.workspaceId && noteId === recoveryScope.noteId,
  );
  function retryRecoveryReservation(): void {
    if (recoveryOwnerId || releaseRecoveryReservation) return;
    releaseRecoveryReservation = reserveNoteDeleteDraft(recoveryScope);
    locallyAdmitted = !!releaseRecoveryReservation;
  }
  let localDeletionHeld = $state(false);
  let domainDeletionHeld = $state(false);
  let backendRetired = $state(false);
  let inputVersion = 0;
  let composing = false;
  let lastSubmittedDraft: PendingRawSave | null = null;
  function deletionHeld(): boolean {
    return (
      !hasRecoveryReservation ||
      deleteHeld ||
      localDeletionHeld ||
      domainDeletionHeld ||
      (appStore.state.daemonHealth?.connectionGeneration ?? 0) !== backendGeneration ||
      isNoteDeleteHeld(editorContentWorkspaceId, editorContentNoteId)
    );
  }
  $effect(() =>
    subscribeNoteDeleteHold(workspaceId, noteId, (held) => {
      backendRetired =
        (appStore.state.daemonHealth?.connectionGeneration ?? 0) !== backendGeneration;
      domainDeletionHeld = held;
      if (held && saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
    }),
  );
  export function setDeletionHeld(held: boolean): void {
    localDeletionHeld = held;
    if (held && saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
  }
  export function getDeleteState() {
    return {
      ownerId,
      version: `${ownerId}:${inputVersion}`,
      dirty:
        editorContent !== lastSavedContent ||
        (!!lastSubmittedDraft &&
          (saveFailed ||
            selectHasPendingNoteContent.select(
              appStore.state,
              editorContentWorkspaceId,
              editorContentNoteId,
            ))),
      composing,
      current:
        hasRecoveryReservation &&
        ownsRecoveryBinding &&
        editorContentWorkspaceId === workspaceId &&
        editorContentNoteId === noteId &&
        backendGeneration === (appStore.state.daemonHealth?.connectionGeneration ?? 0),
    };
  }
  export function retainDeleteDraft(): void {
    if (!hasRecoveryReservation) return;
    const target =
      pendingRawSave ??
      (saveFailed ||
      selectHasPendingNoteContent.select(
        appStore.state,
        editorContentWorkspaceId,
        editorContentNoteId,
      )
        ? lastSubmittedDraft
        : null) ??
      createPendingRawSave();
    if (target.content === target.lastSavedContent) return;
    retainNoteDeleteDraft({
      workspaceId: target.workspaceId,
      noteId: target.noteId,
      backendGeneration,
      ownerId,
      content: target.content,
      baseContent: target.lastSavedContent,
      rev: target.baseRev,
    });
  }

  export async function flushForDeletion(): Promise<void> {
    if (
      !getDeleteState().current ||
      composing ||
      domainDeletionHeld ||
      isNoteDeleteHeld(workspaceId, noteId)
    )
      throw new Error('The note editor is no longer available for deletion');
    flushPendingSave(true);
    await appStore.dispatch(settleNoteContentRequested(workspaceId, noteId));
  }

  let saveFailed = $state(false);
  $effect(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous subscription to the sanctioned write-service queue; this does not fetch domain data.
    subscribeNoteContentFailure(workspaceId, noteId, (failure) => {
      saveFailed = !!failure;
    }),
  );
  let editorContent = $state(getInitialContent());
  // svelte-ignore state_referenced_locally -- one baseline per keyed editor lifetime
  let lastSavedContent = initialDraft?.baseContent ?? getInitialContent();
  // Rev of the store text the editor last synced from. A draft is saved
  // against it, not against the store rev at send time: a note:updated refetch
  // during the save debounce advances the store past the text the user typed
  // on, and naming that newer rev would make the daemon overwrite its change
  // instead of merging.
  let editorContentRev = getInitialRev();
  let editorContentWorkspaceId = getInitialWorkspaceId();
  let editorContentNoteId = getInitialNoteId();
  // svelte-ignore state_referenced_locally -- a handoff starts with an unsaved local draft
  let isUserEditing = $state(!!initialDraft);
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRawSave: PendingRawSave | null = null;
  let propsBeforeSave: { content: string; rev: number | undefined } | null = null;

  // A rich-to-raw handoff is already a local edit. Preserve its original
  // baseline and revision until the normal full-save service accepts it.
  let initialDraftStaged = false;
  $effect(() => {
    if (!initialDraft || initialDraftStaged || !editable || deletionHeld()) return;
    initialDraftStaged = true;
    const pending = createPendingRawSave();
    pendingRawSave = pending;
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null;
      saveRawContent(pending);
      isUserEditing = false;
    }, 1000);
  });

  $effect(() => {
    const latestContent = currentContent;
    const latestRev = rev;
    if (isUserEditing || saveFailed || deletionHeld()) return;
    if (
      selectHasPendingNoteContent.select(appStore.state, workspaceId, noteId) &&
      latestContent !== editorContent
    )
      return;
    if (
      editorContentWorkspaceId === workspaceId &&
      editorContentNoteId === noteId &&
      propsBeforeSave?.content === latestContent &&
      propsBeforeSave.rev === latestRev
    )
      return;
    propsBeforeSave = null;
    if (latestContent !== editorContent) {
      editorContent = latestContent;
      lastSavedContent = latestContent;
    }
    editorContentWorkspaceId = workspaceId;
    editorContentNoteId = noteId;
    editorContentRev = latestRev;
  });

  function getNoteContentForEditor(): string {
    return editorContent;
  }

  function setNoteContentFromEditor(nextContent: string): void {
    if (
      !hasRecoveryReservation ||
      (!ownsRecoveryBinding && !deletionHeld()) ||
      nextContent === editorContent ||
      (!editable && !deletionHeld())
    )
      return;
    editorContent = nextContent;
    if (!deletionHeld()) {
      editorContentWorkspaceId = workspaceId;
      editorContentNoteId = noteId;
    }
    inputVersion++;

    isUserEditing = true;
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    const pendingSave = createPendingRawSave(nextContent);
    pendingRawSave = pendingSave;
    if (deletionHeld()) {
      saveDebounceTimer = null;
      notifyDeleteInput();
      return;
    }
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null;
      saveRawContent(pendingSave);
      // Publish the draft to Redux before allowing incoming content to sync.
      isUserEditing = false;
    }, 1000);
  }

  function notifyDeleteInput(): void {
    if (onDeleteInput) onDeleteInput();
    else if (deletionHeld())
      notifyNoteDeleteInput({
        workspaceId: editorContentWorkspaceId,
        noteId: editorContentNoteId,
        backendGeneration,
        ownerId,
      });
  }

  function createPendingRawSave(nextContent = editorContent): PendingRawSave {
    return {
      workspaceId: editorContentWorkspaceId,
      noteId: editorContentNoteId,
      content: nextContent,
      lastSavedContent,
      baseRev: editorContentRev,
    };
  }

  function saveRawContent(
    target = createPendingRawSave(),
    immediate = false,
    preparingDelete = false,
  ): void {
    if (
      (deletionHeld() && !preparingDelete) ||
      isNoteDeleteHeld(target.workspaceId, target.noteId) ||
      backendGeneration !== (appStore.state.daemonHealth?.connectionGeneration ?? 0)
    )
      return;
    if (!target.workspaceId || !target.noteId || target.content === target.lastSavedContent) return;

    const note = selectNoteById.select(appStore.state, target.workspaceId, target.noteId);
    if (!note) {
      if (preparingDelete) throw new Error('The note is no longer available');
      return;
    }
    if (pendingRawSave === target) pendingRawSave = null;
    lastSubmittedDraft = target;

    if (target.workspaceId === workspaceId && target.noteId === noteId) {
      lastSavedContent = target.content;
      // Selector emissions are coalesced: these props still precede the staged draft.
      propsBeforeSave = { content: currentContent, rev };
    }
    appStore.dispatch(
      updateNoteContent(target.workspaceId, target.noteId, target.content, {
        immediate,
        strict: true,
        baseRev: target.baseRev,
        baseContent: target.lastSavedContent,
      }),
    );
  }

  export function flushPendingSave(preparingDelete = false): void {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    if (pendingRawSave) {
      saveRawContent(pendingRawSave, true, preparingDelete);
      return;
    }
    if (editorContentWorkspaceId === workspaceId && editorContentNoteId === noteId) {
      saveRawContent(createPendingRawSave(), true, preparingDelete);
    }
  }

  onDestroy(() => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    if (deletionHeld()) retainDeleteDraft();
    else flushPendingSave();
    releaseRecoveryReservation?.();
  });
  function trackComposition(element: HTMLElement) {
    const start = () => {
      composing = true;
      inputVersion++;
      notifyDeleteInput();
    };
    const end = () => {
      composing = false;
    };
    element.addEventListener('compositionstart', start);
    element.addEventListener('compositionend', end);
    return {
      destroy() {
        element.removeEventListener('compositionstart', start);
        element.removeEventListener('compositionend', end);
      },
    };
  }
</script>

<div class="flex-1 min-h-0 w-full" data-testid="raw-note-view" use:trackComposition>
  {#if !recoveryOwnerId && !hasRecoveryReservation}
    <div role="alert" class="px-4 py-2 text-sm">
      <p>{m.notes_delete_recoveryCapacity_error()}</p>
      <Button size="sm" onclick={retryRecoveryReservation}>{m.ui_combobox_retry_label()}</Button>
    </div>
  {/if}
  <CodeEditor
    bind:value={getNoteContentForEditor, setNoteContentFromEditor}
    allowLargeContent={true}
    initialSelection={initialDraft?.selection}
    language="markdown"
    readOnly={!editable ||
      !hasRecoveryReservation ||
      !ownsRecoveryBinding ||
      deleteHeld ||
      localDeletionHeld ||
      domainDeletionHeld ||
      backendRetired}
    fileName={noteFilePath}
    {workspaceId}
    filePath={noteFilePath}
    lineWrapping={$lineWrapping}
    {isPanelFocused}
  />
</div>

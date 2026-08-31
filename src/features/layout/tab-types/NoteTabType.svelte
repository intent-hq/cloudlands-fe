<script lang="ts">
  import { onDestroy } from 'svelte';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  /**
   * Note Tab Type Component
   *
   * Renders a note editor with comments,
  version history,
  and header actions.
   * Shows SpecWritingOnboarding when the coordinator is writing the initial spec.
   */

  import type { TabTypeComponentProps } from './registry';
  import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    selectIsInitialSpecWriteInProgress,
    selectInitialAgentId,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectNoteById,
    selectWorkspaceNotesState,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { createNote, deleteNote } from '$features/notes/notes-write-service';
  import { ensureNoteContentLoaded } from '$features/notes/notes-read-service';
  import { isSpecNote } from '$shared/constants/notes';
  import { isNoteContentStale } from '$shared/utils/note-content';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import NoteWithComments from '$lib/components/workspace/NoteWithComments.svelte';
  import NoteVersionHistory from '$lib/components/workspace/NoteVersionHistory.svelte';
  import SpecWritingOnboarding from '$lib/components/workspace/SpecWritingOnboarding.svelte';
  import { Button } from '$lib/components/ui/button';
  import { withToastCountdown } from '$lib/components/ui/toast/toast-countdown';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Menu from '$lib/components/ui/menu';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import NoteViewSettingsDropdown from './NoteViewSettingsDropdown.svelte';
  import { selectScrollPosition } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { saveScrollPosition } from '$store/renderer/slices/tab-state/tab-state-slice';

  import Fa from 'svelte-fa';
  import { faCheck, faCopy, faNoteSticky, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import NoteContentSurface, { type NoteContentState } from './NoteContentSurface.svelte';

  const logger = createLogger('NoteTabType');

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const scrollPosition = selectScrollPosition(tab.id);

  // svelte-ignore state_referenced_locally
  const note = selectNoteById(workspaceId, tab.noteId);
  // svelte-ignore state_referenced_locally
  const notesState = selectWorkspaceNotesState(workspaceId);

  // Version history state
  let showVersionHistory = $state(false);

  // Copy/delete state
  let noteCopyFeedback = $state<string | null>(null);
  let noteCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isNoteDeleting = $state(false);

  onDestroy(() => {
    if (noteCopyTimeoutId) {
      clearTimeout(noteCopyTimeoutId);
      noteCopyTimeoutId = null;
    }
  });

  // Slim note.list rows carry no content (§5.2); fetch the full body when this
  // tab shows a note whose content has not been loaded yet. A failed fetch
  // leaves the row stale (notes.get swallows errors), so track it locally and
  // surface an error state with retry instead of a permanent loading state.
  const noteContentStale = $derived(isNoteContentStale($note));
  let contentLoadFailedNoteId = $state<string | null>(null);
  const noteContentLoadFailed = $derived(
    noteContentStale && contentLoadFailedNoteId === tab.noteId,
  );
  $effect(() => {
    const noteId = tab.noteId;
    if (!isActive || !noteId || !noteContentStale || contentLoadFailedNoteId === noteId) return;
    void ensureNoteContentLoaded(workspaceId, noteId).then((loaded) => {
      if (!loaded && tab.noteId === noteId) contentLoadFailedNoteId = noteId;
    });
  });

  function retryNoteContentLoad() {
    contentLoadFailedNoteId = null;
  }

  // Get actual workspace root for file path
  let actualWorkspaceRoot = $state<string | null>(null);
  $effect(() => {
    if (isActive && workspaceId) {
      invoke<string>('workspace:get-root', { workspaceId }).then((rootPath) => {
        if (rootPath) actualWorkspaceRoot = rootPath;
      });
    }
  });

  const noteFilePath = $derived(
    actualWorkspaceRoot && $note?.id
      ? `${actualWorkspaceRoot}/.workspace/notes/${$note.id}.md`
      : '',
  );

  // Track if initial spec write is in progress — read from Redux
  // svelte-ignore state_referenced_locally
  const isInitialSpecWriteInProgressStore = selectIsInitialSpecWriteInProgress(workspaceId ?? '');
  let isInitialSpecWriteInProgress = $derived($isInitialSpecWriteInProgressStore);

  // Find the initial spec-writer agent ID for this workspace
  // Used to pass to the onboarding component so it can stop the agent
  const initialSpecWriterAgentId = $derived.by(() => {
    if (!workspaceId || !isInitialSpecWriteInProgress) return null;

    // Use Redux to find the initial agent and verify it's a spec-writer
    const state = appStore.state;
    const initialAgentId = selectInitialAgentId.select(state, workspaceId);
    if (!initialAgentId) return null;

    const agent = selectAgentSession.select(state, initialAgentId);
    const isSpecWriter = (agent?.metadata as any)?.specialist === 'spec-writer';
    return isSpecWriter ? initialAgentId : null;
  });

  // DEBUG: Set to true to always show the spec onboarding UI for design testing
  const MIMIC_SPEC_WRITING = false;

  // Determine if we should show the onboarding component instead of the editor
  // Show onboarding when: spec note + empty content + initial spec write in progress
  const showSpecOnboarding = $derived.by(() => {
    if (!tab.noteId) return false;
    if (!isSpecNote(tab.noteId)) return false;

    // DEBUG: Always show onboarding for design testing
    if (MIMIC_SPEC_WRITING) return true;

    if (!isInitialSpecWriteInProgress) return false;
    // Only show onboarding if the note is empty
    const hasContent = $note && $note.content && $note.content.trim().length > 0;
    return !hasContent;
  });

  // Compute editable state
  const noteEditable = $derived.by(() => {
    if (!tab.noteId) return true;
    if ($note && $note.content && $note.content.trim().length > 0) return true;
    if (MIMIC_SPEC_WRITING) return false;
    if (isSpecNote(tab.noteId)) return !isInitialSpecWriteInProgress;
    return true;
  });

  const noteContentState = $derived.by<NoteContentState>(() => {
    if (!tab.noteId) return 'missing';
    if (!$note) return $notesState.loading || !$notesState.initialized ? 'loading' : 'missing';
    if (noteContentLoadFailed) return 'error';
    if (noteContentStale) return 'loading';
    if (!noteEditable) return 'read-only';
    if (!$note.content?.trim()) return 'empty';
    return 'editor';
  });

  async function handleCopyNote() {
    if (!$note) return;
    try {
      await navigator.clipboard.writeText($note.content || '');
      noteCopyFeedback = m.layout_noteTab_copiedFullNote_label();
      if (noteCopyTimeoutId) clearTimeout(noteCopyTimeoutId);
      noteCopyTimeoutId = setTimeout(() => {
        noteCopyFeedback = null;
        noteCopyTimeoutId = null;
      }, 2000);
    } catch (error) {
      logger.error('Failed to copy note', error);
    }
  }

  async function handleDeleteNote() {
    if (!tab.noteId || isNoteDeleting) return;
    if (isSpecNote(tab.noteId)) {
      const { toast } = await import('svelte-sonner');
      toast.error(m.layout_noteTab_cannotDeleteSpec_error());
      return;
    }
    const noteIdToDelete = tab.noteId;

    const savedNote = $note ? { ...$note } : null;
    const noteTitle = $note?.title || m.layout_tabTypes_note_title();
    isNoteDeleting = true;
    try {
      appStore.dispatch(closeTab(workspaceId, tab.id));
      void deleteNote(workspaceId, noteIdToDelete);

      // Show undo toast
      const { toast } = await import('svelte-sonner');
      const toastId = toast.warning(
        m.layout_noteTab_deletedNote_toast({ title: noteTitle }),
        withToastCountdown(
          {
            duration: 15000,
            action: savedNote
              ? {
                  label: m.ui_workspaceActions_undo_label(),
                  onClick: () => {
                    try {
                      void createNote(savedNote.workspaceId, {
                        title: savedNote.title,
                        content: savedNote.content,
                        contentType: savedNote.contentType,
                        tags: savedNote.tags,
                        parentId: savedNote.parentId,
                        visibility: savedNote.visibility,
                      });
                      toast.dismiss(toastId);
                    } catch (err) {
                      logger.error('Failed to restore note', err);
                      toast.error(m.layout_noteTab_restoreFailed_error());
                    }
                  },
                }
              : undefined,
          },
          { pauseOnHover: false },
        ),
      );
    } catch (error) {
      logger.error('Failed to delete note', error);
      const { toast } = await import('svelte-sonner');
      toast.error(m.layout_noteTab_deleteFailed_error());
    } finally {
      isNoteDeleting = false;
    }
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({ display: noteDisplayActions, actions: noteActions });
  });
</script>

{#snippet noteDisplayActions()}
  {#if tab.noteId}
    <NoteViewSettingsDropdown {workspaceId} noteId={tab.noteId} embedded />
  {/if}
{/snippet}

{#snippet noteActions()}
  <Menu.CommandItem
    icon={noteCopyFeedback ? faCheck : faCopy}
    label={noteCopyFeedback || m.layout_noteTab_copyFullNote_tooltip()}
    onclick={handleCopyNote}
  />
  {#if noteFilePath}
    <OpenComboButton filePath={noteFilePath} {workspaceId} isDirectory={false} embedded />
  {/if}
  {#if tab.noteId && !isSpecNote(tab.noteId)}
    <Menu.CommandItem
      icon={faTrash}
      label={m.layout_noteTab_deleteNote_tooltip()}
      onclick={handleDeleteNote}
      disabled={isNoteDeleting}
      destructive
    />
  {/if}
{/snippet}

<NoteContentSurface state={noteContentState}>
  {#if tab.noteId}
    {#if noteContentLoadFailed}
      <div class="flex flex-col items-center justify-center h-full text-subtle gap-3">
        <p>{m.layout_noteTab_contentLoadFailed_error()}</p>
        <Button variant="outline" size="sm" onclick={retryNoteContentLoad}>
          {m.ui_errorToast_retry_label()}
        </Button>
      </div>
    {:else if !$note}
      <div class="flex flex-col h-full">
        <div class="flex-1 p-4 space-y-4">
          <Skeleton class="h-8 w-3/4" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="h-4 w-5/6" />
          <Skeleton class="h-4 w-4/5" />
          <Skeleton class="h-4 w-full" />
        </div>
      </div>
    {:else if showVersionHistory && $workspace}
      <NoteVersionHistory
        workspace={$workspace}
        noteId={tab.noteId}
        currentContent={$note?.content || ''}
        onRestore={() => (showVersionHistory = false)}
      />
    {:else if showSpecOnboarding}
      <!-- Show onboarding when coordinator is writing initial spec -->
      <SpecWritingOnboarding agentId={initialSpecWriterAgentId} {workspaceId} />
    {:else if $workspace}
      <NoteWithComments
        workspace={$workspace}
        noteId={tab.noteId}
        editable={noteEditable}
        {isPanelFocused}
        initialScrollPosition={$scrollPosition}
        onScrollPositionSave={(scrollTop: number) =>
          appStore.dispatch(saveScrollPosition(tab.id, scrollTop))}
      />
    {/if}
  {:else}
    <div class="flex flex-col items-center justify-center h-full text-subtle gap-2">
      <Fa icon={faNoteSticky} class="text-4xl opacity-50" />
      <p>{m.layout_noteTab_noNoteSelected_label()}</p>
    </div>
  {/if}
</NoteContentSurface>

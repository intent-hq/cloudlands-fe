<script lang="ts">
import { selectAgentSession } from '$lib/store/slices/agent-session/agent-session-selectors';
  /**
   * Note Tab Type Component
   *
   * Renders a note editor with comments,
  version history,
  and header actions.
   * Shows SpecWritingOnboarding when the coordinator is writing the initial spec.
   */

  import type { TabTypeComponentProps } from './registry';
  import { closeTab } from '$lib/store/slices/panel-layout/panel-layout-slice';

  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
  selectIsInitialSpecWriteInProgress,
  selectInitialAgentId,
} from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { selectNoteById } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import {
  createNote,
  deleteNote,
} from '$lib/store/slices/workspace-notes/workspace-notes-slice';
  import { selectIsRawNoteViewEnabled } from '$lib/store/slices/transient-ui/transient-ui-selectors';
  import { toggleRawNoteView } from '$lib/store/slices/transient-ui/transient-ui-slice';
  import { isSpecNote } from '$shared/constants/notes';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import NoteWithComments from '$lib/components/workspace/NoteWithComments.svelte';
  import NoteVersionHistory from '$lib/components/workspace/NoteVersionHistory.svelte';
  import SpecWritingOnboarding from '$lib/components/workspace/SpecWritingOnboarding.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import NoteFontStyleButton from '$lib/components/notes/NoteFontStyleButton.svelte';
  import { selectSpellcheckEnabled } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { toggleSpellcheck } from '$lib/store/slices/user-preferences/user-preferences-slice';
  import { selectScrollPosition } from '$lib/store/slices/tab-state/tab-state-selectors';
  import { saveScrollPosition } from '$lib/store/slices/tab-state/tab-state-slice';

  import Fa from 'svelte-fa';
  import {
  faCheck,
  faCode,
  faCopy,
  faSpellCheck,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { track } from '$lib/services/analytics';
  import { store as appStore } from '$lib/store/store';

  const logger = createLogger('NoteTabType');

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  const workspace = selectWorkspaceById(workspaceId);
  const spellcheckEnabled = selectSpellcheckEnabled();
  const scrollPosition = selectScrollPosition(tab.id);

  const note = selectNoteById(workspaceId, tab.noteId);
  const rawNoteViewEnabled = selectIsRawNoteViewEnabled(workspaceId, tab.noteId ?? '');
  const headerToggleActiveClass =
    'text-foreground bg-sidebar hover:text-foreground hover:bg-sidebar';
  const headerToggleInactiveClass = 'text-subtle';
  const rawNoteToggleLabel = $derived(
    $rawNoteViewEnabled ? 'Show rich note view' : 'Show raw markdown note view',
  );

  // Version history state
  let showVersionHistory = $state(false);

  // Copy/delete state
  let noteCopyFeedback = $state<string | null>(null);
  let noteCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isNoteDeleting = $state(false);

  // Get actual workspace root for file path
  let actualWorkspaceRoot = $state<string | null>(null);
  $effect(() => {
    if (workspaceId) {
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

  async function handleCopyNote() {
    if (!$note) return;
    try {
      await navigator.clipboard.writeText($note.content || '');
      noteCopyFeedback = 'Copied full note';
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
      toast.error('Cannot delete the space spec');
      return;
    }
    const noteIdToDelete = tab.noteId;

    // Get note info for tracking before deletion
    const noteToDelete = selectNoteById.select(
      appStore.state,
      workspaceId,
      noteIdToDelete,
    );
    const noteType = noteToDelete?.metadata?.task ? 'task' : 'regular';
    let noteAgeDays: number | undefined;
    if (noteToDelete?.createdAt) {
      const createdDate = new Date(noteToDelete.createdAt);
      const now = new Date();
      noteAgeDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    const savedNote = $note ? { ...$note } : null;
    const noteTitle = $note?.title || 'Note';
    isNoteDeleting = true;
    try {
      appStore.dispatch(closeTab(workspaceId, tab.id));
      appStore.dispatch(deleteNote(workspaceId, noteIdToDelete));

      // Track deletion (optimistic — saga handles IPC + errors)
      track('Deleted Note', { note_type: noteType, note_age_days: noteAgeDays });

      // Show undo toast
      const { toast } = await import('svelte-sonner');
      const toastId = toast.warning(`Deleted "${noteTitle}"`, {
        duration: 15000,
        action: savedNote
          ? {
              label: 'Undo',
              onClick: () => {
                try {
                  appStore.dispatch(
                    createNote(savedNote.workspaceId, {
                      title: savedNote.title,
                      content: savedNote.content,
                      contentType: savedNote.contentType,
                      tags: savedNote.tags,
                      parentId: savedNote.parentId,
                      visibility: savedNote.visibility,
                    }),
                  );
                  toast.dismiss(toastId);
                } catch (err) {
                  logger.error('Failed to restore note', err);
                  toast.error('Failed to restore note');
                }
              },
            }
          : undefined,
      });
    } catch (error) {
      logger.error('Failed to delete note', error);
      const { toast } = await import('svelte-sonner');
      toast.error('Failed to delete note');
    } finally {
      isNoteDeleting = false;
    }
  }

  function handleToggleRawNoteView() {
    if (!tab.noteId) return;
    appStore.dispatch(toggleRawNoteView(workspaceId, tab.noteId));
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions(noteActions);
  });
</script>

{#snippet noteActions()}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleCopyNote}
    tooltip={noteCopyFeedback || 'Copy full note'}
    tooltipSide="bottom"
    aria-label="Copy full note"
  >
    {#if noteCopyFeedback}
      <Fa icon={faCheck} size="xs" class="text-green-500" />
    {:else}
      <Fa icon={faCopy} size="xs" />
    {/if}
  </Button>
  {#if tab.noteId}
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleToggleRawNoteView}
      tooltip={rawNoteToggleLabel}
      tooltipSide="bottom"
      aria-label={rawNoteToggleLabel}
      aria-pressed={$rawNoteViewEnabled}
      class={$rawNoteViewEnabled ? headerToggleActiveClass : headerToggleInactiveClass}
      data-testid="note-raw-view-toggle"
    >
      <Fa icon={faCode} size="xs" />
    </Button>
  {/if}
  <!-- Version history toggle hidden for now -->
  <!-- <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => (showVersionHistory = !showVersionHistory)}
    tooltip={showVersionHistory ? 'Hide version history' : 'Show version history'}
    tooltipSide="bottom"
    class={showVersionHistory ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faClockRotateLeft} size="xs" />
  </Button> -->
  <NoteFontStyleButton />
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleSpellcheck())}
    tooltip={$spellcheckEnabled ? 'Spellcheck: On' : 'Spellcheck: Off'}
    tooltipSide="bottom"
    aria-pressed={$spellcheckEnabled}
    class={$spellcheckEnabled ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faSpellCheck} size="xs" />
  </Button>
  {#if noteFilePath}
    <OpenComboButton filePath={noteFilePath} isDirectory={false} compact />
  {/if}
  {#if tab.noteId && !isSpecNote(tab.noteId)}
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleDeleteNote}
      tooltip="Delete note"
      tooltipSide="bottom"
      disabled={isNoteDeleting}
    >
      <Fa icon={faTrash} size="xs" />
    </Button>
  {/if}
{/snippet}

{#if tab.noteId}
  {#if !$note}
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
      onScrollPositionSave={(scrollTop: number) => appStore.dispatch(saveScrollPosition(tab.id, scrollTop))}
    />
  {/if}
{:else}
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-2">
    <Fa icon={faNote} class="text-4xl opacity-50" />
    <p>No note selected</p>
  </div>
{/if}

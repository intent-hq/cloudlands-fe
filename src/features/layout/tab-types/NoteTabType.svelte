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
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
  createNote,
  deleteNote,
} from '$features/notes/notes-write-service';
  import { selectIsRawNoteViewEnabled } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import { toggleRawNoteView } from '$store/renderer/slices/transient-ui/transient-ui-slice';
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
  import { selectSpellcheckEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { toggleSpellcheck } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectScrollPosition } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { saveScrollPosition } from '$store/renderer/slices/tab-state/tab-state-slice';

  import Fa from 'svelte-fa';
  import {
  faCheck,
  faCode,
  faCopy,
  faSpellCheck,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

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
    $rawNoteViewEnabled ? m.layout_noteTab_showRichView_label() : m.layout_noteTab_showRawView_label(),
  );

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
      const toastId = toast.warning(m.layout_noteTab_deletedNote_toast({ title: noteTitle }), {
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
      });
    } catch (error) {
      logger.error('Failed to delete note', error);
      const { toast } = await import('svelte-sonner');
      toast.error(m.layout_noteTab_deleteFailed_error());
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
    tooltip={noteCopyFeedback || m.layout_noteTab_copyFullNote_tooltip()}
    tooltipSide="bottom"
    aria-label={m.layout_noteTab_copyFullNote_tooltip()}
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
    tooltip={showVersionHistory
      ? m.layout_noteTab_hideVersionHistory_tooltip()
      : m.layout_noteTab_showVersionHistory_tooltip()}
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
    tooltip={$spellcheckEnabled
      ? m.layout_noteTab_spellcheckOn_tooltip()
      : m.layout_noteTab_spellcheckOff_tooltip()}
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
      tooltip={m.layout_noteTab_deleteNote_tooltip()}
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
    <p>{m.layout_noteTab_noNoteSelected_label()}</p>
  </div>
{/if}

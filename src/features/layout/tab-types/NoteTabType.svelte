<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
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
    selectNoteContentView,
    selectNotePresenceView,
    selectNoteWorkspaceRoot,
    selectWorkspaceNotesState,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    createNotePersistRequested,
    deleteNotePersistRequested,
    noteContentViewReleased,
    noteContentViewRequested,
    notePresenceViewReleased,
    notePresenceViewRequested,
    noteWorkspaceRootReleased,
    noteWorkspaceRootRequested,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { isSpecNote } from '$shared/constants/notes';
  import { isNoteContentStale } from '$shared/utils/note-content';
  import { createLogger } from '$lib/utils/client-logger';
  import NoteWithComments from '$lib/components/workspace/NoteWithComments.svelte';
  import NoteVersionHistory from '$lib/components/workspace/NoteVersionHistory.svelte';
  import SpecWritingOnboarding from '$lib/components/workspace/SpecWritingOnboarding.svelte';
  import { Button } from '$lib/components/ui/button';
  import { withToastCountdown } from '$lib/components/patterns/notify';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Menu from '$lib/components/ui/menu';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import NoteViewSettingsDropdown from './NoteViewSettingsDropdown.svelte';
  import RenderedNotePreview from './RenderedNotePreview.svelte';
  import NotePresenceAvatarStack from '$features/notes/note-presence/NotePresenceAvatarStack.svelte';
  import { selectAllScrollPositions } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { saveScrollPosition } from '$store/renderer/slices/tab-state/tab-state-slice';

  import Fa from 'svelte-fa';
  import { faCheck, faCopy, faNoteSticky, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import NoteContentSurface, { type NoteContentState } from './NoteContentSurface.svelte';
  import { selectNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';

  const logger = createLogger('NoteTabType');

  let { tab, workspaceId, layoutId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const scrollPositions = selectAllScrollPositions();
  const scrollPosition = $derived($scrollPositions[tab.id]);

  // svelte-ignore state_referenced_locally
  const note = selectNoteById(workspaceId, tab.noteId);
  // svelte-ignore state_referenced_locally
  const notesState = selectWorkspaceNotesState(workspaceId);
  // svelte-ignore state_referenced_locally - initial selector target; effects below retarget on prop changes
  const noteViewWorkspaceIdStore = writable(workspaceId);
  // svelte-ignore state_referenced_locally - initial selector target; effects below retarget on prop changes
  const noteViewNoteIdStore = writable(tab.noteId ?? '');
  $effect(() => noteViewWorkspaceIdStore.set(workspaceId));
  $effect(() => noteViewNoteIdStore.set(tab.noteId ?? ''));
  const noteViewModeStore = selectNoteViewMode(noteViewWorkspaceIdStore, noteViewNoteIdStore);
  const noteViewMode = $derived($noteViewModeStore);
  // svelte-ignore state_referenced_locally - selector targets are retargeted by the effects below
  const noteUiConsumerStore = writable(`note-tab:${tab.id}`);
  $effect(() => noteUiConsumerStore.set(`note-tab:${tab.id}`));
  const noteContentView = selectNoteContentView(noteViewWorkspaceIdStore, noteUiConsumerStore);
  const noteWorkspaceRoot = selectNoteWorkspaceRoot(noteViewWorkspaceIdStore, noteUiConsumerStore);
  const notePresenceView = selectNotePresenceView(noteViewWorkspaceIdStore, noteUiConsumerStore);
  const principalConnectionContext = selectPrincipalConnectionContext();
  let noteUiRequestSequence = 0;

  function nextNoteUiRequestId(consumerId: string, kind: string): string {
    noteUiRequestSequence += 1;
    return `${consumerId}:${kind}:${noteUiRequestSequence}`;
  }

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

  // Slim note.list rows carry no content (§5.2); the read saga owns the request
  // and its consumer/resource/authority-correlated outcome.
  const noteContentStale = $derived(isNoteContentStale($note));
  const noteContentLoadFailed = $derived(
    noteContentStale &&
      $noteContentView?.workspaceId === workspaceId &&
      $noteContentView?.noteId === tab.noteId &&
      $noteContentView?.status === 'error',
  );
  $effect(() => {
    const noteId = tab.noteId;
    const consumerId = `note-tab:${tab.id}`;
    if (!isActive || !noteId || !noteContentStale || !$principalConnectionContext) return;
    appStore.dispatch(
      noteContentViewRequested(
        consumerId,
        nextNoteUiRequestId(consumerId, 'content'),
        workspaceId,
        noteId,
      ),
    );
    return () => appStore.dispatch(noteContentViewReleased(workspaceId, consumerId));
  });

  function retryNoteContentLoad() {
    const noteId = tab.noteId;
    const consumerId = `note-tab:${tab.id}`;
    if (!noteId) return;
    appStore.dispatch(
      noteContentViewRequested(
        consumerId,
        nextNoteUiRequestId(consumerId, 'content'),
        workspaceId,
        noteId,
      ),
    );
  }

  // Get the actual workspace root through the saga-owned correlated read.
  $effect(() => {
    const consumerId = `note-tab:${tab.id}`;
    if (!isActive || !workspaceId || !$principalConnectionContext) return;
    appStore.dispatch(
      noteWorkspaceRootRequested(consumerId, nextNoteUiRequestId(consumerId, 'root'), workspaceId),
    );
    return () => appStore.dispatch(noteWorkspaceRootReleased(workspaceId, consumerId));
  });

  const noteFilePath = $derived(
    $noteWorkspaceRoot?.status === 'ready' && $noteWorkspaceRoot.path && $note?.id
      ? `${$noteWorkspaceRoot.path}/.workspace/notes/${$note.id}.md`
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
  const showRenderedPreview = $derived(
    (noteViewMode === 'preview' || !$workspace) && !showSpecOnboarding,
  );
  const noteContentState = $derived.by<NoteContentState>(() => {
    if (!tab.noteId) return 'missing';
    if (!$note) return $notesState.loading || !$notesState.initialized ? 'loading' : 'missing';
    if (noteContentLoadFailed) return 'error';
    if (noteContentStale) return 'loading';
    if (!noteEditable) return 'read-only';
    if (showRenderedPreview) return 'read-only';
    if (!$note.content?.trim()) return 'empty';
    return 'editor';
  });

  function handlePreviewScrollPositionSave(scrollKey: string, scrollTop: number) {
    appStore.dispatch(saveScrollPosition(scrollKey, scrollTop));
  }

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
      const { notify } = await import('$lib/components/patterns/notify');
      notify.error(m.layout_noteTab_cannotDeleteSpec_error());
      return;
    }
    const noteIdToDelete = tab.noteId;

    const savedNote = $note ? { ...$note } : null;
    const noteTitle = $note?.title || m.layout_tabTypes_note_title();
    isNoteDeleting = true;
    try {
      appStore.dispatch(closeTab(layoutId ?? workspaceId, tab.id));
      void appStore.dispatch(deleteNotePersistRequested(workspaceId, noteIdToDelete));

      // Show undo toast
      const { notify } = await import('$lib/components/patterns/notify');
      const toastId = notify.warning(
        m.layout_noteTab_deletedNote_toast({ title: noteTitle }),
        withToastCountdown(
          {
            duration: 15000,
            action: savedNote
              ? {
                  label: m.ui_workspaceActions_undo_label(),
                  onClick: () => {
                    try {
                      void appStore.dispatch(
                        createNotePersistRequested(savedNote.workspaceId, {
                          title: savedNote.title,
                          content: savedNote.content,
                          contentType: savedNote.contentType,
                          tags: savedNote.tags,
                          parentId: savedNote.parentId,
                          visibility: savedNote.visibility,
                        }),
                      );
                      notify.dismiss(toastId);
                    } catch (err) {
                      logger.error('Failed to restore note', err);
                      notify.error(m.layout_noteTab_restoreFailed_error());
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
      const { notify } = await import('$lib/components/patterns/notify');
      notify.error(m.layout_noteTab_deleteFailed_error());
    } finally {
      isNoteDeleting = false;
    }
  }

  // Other people's presence is only possible in a shared workspace.
  const showPresenceStack = $derived(($workspace?.memberCount ?? 0) >= 2 && !!tab.noteId);

  // Viewing presence belongs to the visible tab, including raw/preview mode.
  // The saga owns the lease; the lazy menu renders its serializable projection.
  $effect(() => {
    const noteId = tab.noteId;
    const consumerId = `note-tab:${tab.id}`;
    if (!isActive || !showPresenceStack || !noteId || !$principalConnectionContext) return;
    appStore.dispatch(
      notePresenceViewRequested(
        consumerId,
        nextNoteUiRequestId(consumerId, 'presence'),
        workspaceId,
        noteId,
      ),
    );
    return () => appStore.dispatch(notePresenceViewReleased(workspaceId, consumerId));
  });

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    return headerContext.registerActions({
      display: noteDisplayActions,
      actions: noteActions,
      destructive: tab.noteId && !isSpecNote(tab.noteId) ? noteDestructiveActions : undefined,
    });
  });
</script>

{#snippet noteDisplayActions()}
  {#if tab.noteId}
    <NoteViewSettingsDropdown
      {workspaceId}
      noteId={tab.noteId}
      canEdit={!!$workspace && noteEditable}
      embedded
    />
  {/if}
{/snippet}

{#snippet noteActions()}
  {#if showPresenceStack && tab.noteId}
    <NotePresenceAvatarStack viewers={$notePresenceView?.viewers ?? []} embedded />
  {/if}
  <Menu.CommandItem
    icon={noteCopyFeedback ? faCheck : faCopy}
    label={noteCopyFeedback || m.layout_noteTab_copyFullNote_tooltip()}
    onclick={handleCopyNote}
  />
  {#if noteFilePath}
    <OpenComboButton filePath={noteFilePath} {workspaceId} isDirectory={false} embedded />
  {/if}
{/snippet}

{#snippet noteDestructiveActions()}
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

<div class="flex h-full min-h-0 flex-col">
  <div class="min-h-0 flex-1">
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
        {:else if showRenderedPreview}
          <RenderedNotePreview
            content={$note.content || ''}
            {workspaceId}
            noteId={tab.noteId}
            scrollKey={tab.id}
            initialScrollPosition={scrollPosition}
            onScrollPositionSave={handlePreviewScrollPositionSave}
          />
        {:else if $workspace}
          <NoteWithComments
            workspace={$workspace}
            noteId={tab.noteId}
            editable={noteEditable}
            {isPanelFocused}
            initialScrollPosition={scrollPosition}
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
  </div>
</div>

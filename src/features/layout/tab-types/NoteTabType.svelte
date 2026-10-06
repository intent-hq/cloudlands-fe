<script lang="ts">
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { selectNotePageSession } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import { createNoteReadingSurface } from '$features/notes/virtualized/note-reading-surface';
  import type { CanonicalNoteHit } from '$features/notes/virtualized/note-canonical-search';
  import { onDestroy, tick } from 'svelte';
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
    selectWorkspaceNotesState,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { createNote, deleteNote } from '$features/notes/notes-write-service';
  import { beginFullNoteEdit, ensureNoteContentLoaded } from '$features/notes/notes-read-service';
  import { isSpecNote } from '$shared/constants/notes';
  import { isNoteContentStale } from '$shared/utils/note-content';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import NoteReadingView from '$features/notes/virtualized/NoteReadingView.svelte';
  import {
    pagePanelOpened,
    pagePanelClosed,
    pageResourceLimitsConfigured,
  } from '$store/renderer/slices/note-pages/note-pages-slice';
  import type { NoteReadingSurface } from '$features/notes/virtualized/note-window-view';
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
  import {
    joinNotePresence,
    type RemoteNoteViewer,
  } from '$features/notes/note-presence/note-presence-service';
  import NotePresenceAvatarStack from '$features/notes/note-presence/NotePresenceAvatarStack.svelte';
  import { selectAllScrollPositions } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { saveScrollPosition } from '$store/renderer/slices/tab-state/tab-state-slice';

  import Fa from 'svelte-fa';
  import { faCheck, faCopy, faNoteSticky, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import NoteContentSurface, { type NoteContentState } from './NoteContentSurface.svelte';
  import { selectNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-selectors';

  const logger = createLogger('NoteTabType');

  // Normal note tabs negotiate the read-only capability. Complete source is loaded only by Edit.
  let {
    tab,
    workspaceId,
    layoutId,
    isActive,
    isPanelFocused,
    readingSurface,
  }: TabTypeComponentProps & {
    readingSurface?: NoteReadingSurface;
  } = $props();

  const headerContext = getPanelHeaderContext();

  const scrollPositions = selectAllScrollPositions();
  const scrollPosition = $derived($scrollPositions[tab.id]);

  // svelte-ignore state_referenced_locally - initial selector target; effects below retarget on prop changes
  const noteViewWorkspaceIdStore = writable(workspaceId);
  // svelte-ignore state_referenced_locally - initial selector target; effects below retarget on prop changes
  const noteViewNoteIdStore = writable(tab.noteId ?? '');
  $effect(() => noteViewWorkspaceIdStore.set(workspaceId));
  $effect(() => noteViewNoteIdStore.set(tab.noteId ?? ''));
  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(noteViewWorkspaceIdStore);
  const note = selectNoteById(noteViewWorkspaceIdStore, noteViewNoteIdStore);
  // svelte-ignore state_referenced_locally
  const notesState = selectWorkspaceNotesState(noteViewWorkspaceIdStore);
  const noteViewModeStore = selectNoteViewMode(noteViewWorkspaceIdStore, noteViewNoteIdStore);
  const noteViewMode = $derived($noteViewModeStore);
  let editState = $state<'view' | 'loading' | 'editing' | 'error'>('view');
  let editLease: ReturnType<typeof beginFullNoteEdit> | undefined;
  let fullEditor = $state<{ finishEditing(): Promise<void> } | null>(null);
  let leavingEdit = $state(false);
  let showPagedFind = $state(false),
    pagedQuery = $state(''),
    pagedFindError = $state(false);
  let pagedHits = $state<CanonicalNoteHit[]>([]),
    pagedHitIndex = $state(0),
    pagedFindExact = $state(true);
  let findGeneration = 0;
  let readingView:
    import('$features/notes/virtualized/note-window-view').NoteWindowView | undefined;
  const normalReadingSurface = $derived(
    createNoteReadingSurface(
      workspaceId,
      tab.noteId ?? '',
      tab.id,
      () => {
        showPagedFind = true;
      },
      () => {
        pagedHits = [];
      },
    ),
  );
  const pageSession = selectNotePageSession(noteViewWorkspaceIdStore, noteViewNoteIdStore);
  // Window/cache updates keep the same search identity. Only changing notes or
  // invalidating the revision may retire results while navigating between pages.
  const pagedSearchIdentity = $derived(
    JSON.stringify([
      workspaceId,
      tab.noteId,
      $pageSession?.generation,
      $pageSession?.state?.sourceRevision,
    ]),
  );
  $effect(() => {
    void pagedSearchIdentity;
    return () => {
      findGeneration++;
      pagedHits = [];
      selectedReadingSurface?.cancelRenderedSearch?.();
    };
  });
  const selectedReadingSurface = $derived(readingSurface ?? normalReadingSurface);
  const pagedSurface = $derived(
    editState === 'view' && $workspace ? selectedReadingSurface : undefined,
  );
  $effect(() => {
    const owned = normalReadingSurface;
    return () => owned.dispose();
  });
  function readingReady(view: typeof readingView) {
    if (!view) return;
    readingView = view;
    pagedSurface?.ready?.(view);
  }
  function revealPagedHit(index: number) {
    if (!pagedHits.length) return;
    pagedHitIndex = (index + pagedHits.length) % pagedHits.length;
    const { start, end } = pagedHits[pagedHitIndex].sourceRange;
    readingView?.setSelection({ anchor: start, head: end, anchorAffinity: 1, headAffinity: -1 });
    readingView?.reveal(start);
  }
  async function findPagedText() {
    const generation = ++findGeneration,
      surface = pagedSurface;
    pagedHits = [];
    surface?.cancelRenderedSearch?.();
    pagedHitIndex = 0;
    pagedFindError = false;
    pagedFindExact = true;
    if (!pagedQuery.trim() || !surface?.searchRendered) return;
    try {
      await surface.searchRendered(pagedQuery, async (page) => {
        if (generation !== findGeneration) return;
        pagedHits = [...pagedHits, ...page.hits];
        pagedFindExact = page.count.exact;
      });
      if (generation === findGeneration) revealPagedHit(0);
    } catch {
      if (generation === findGeneration) {
        pagedFindError = true;
        pagedHits = [];
        surface.cancelRenderedSearch?.();
      }
    }
  }
  function closePagedFind() {
    findGeneration++;
    pagedHits = [];
    pagedSurface?.cancelRenderedSearch?.();
    showPagedFind = false;
  }

  $effect(() => {
    const ownerWorkspace = workspaceId,
      ownerNote = tab.noteId;
    return () => {
      void ownerWorkspace;
      void ownerNote;
      editLease?.release();
      editLease = undefined;
      editState = 'view';
    };
  });

  async function startFullEdit() {
    if (!noteEditable || !$workspace || !tab.noteId || editState === 'loading') return;
    editLease?.release();
    const ownerWorkspace = workspaceId,
      ownerNote = tab.noteId;
    const lease = beginFullNoteEdit(ownerWorkspace, ownerNote);
    editLease = lease;
    editState = 'loading';
    // Let the reading view and its panel owner retire before mounting an editor.
    await tick();
    const loaded = await lease.load();
    if (editLease !== lease || workspaceId !== ownerWorkspace || tab.noteId !== ownerNote) return;
    if (!noteEditable || !$workspace) {
      cancelFullEdit();
      return;
    }
    editState = loaded ? 'editing' : 'error';
    if (!loaded) {
      lease.release();
      editLease = undefined;
    }
  }
  function cancelFullEdit() {
    editLease?.release();
    editLease = undefined;
    editState = 'view';
  }
  async function finishFullEdit() {
    if (leavingEdit) return;
    leavingEdit = true;
    const lease = editLease;
    try {
      await fullEditor?.finishEditing?.();
      if (editLease === lease) cancelFullEdit();
    } catch (error) {
      logger.warn('Full note edit remains open because saving failed', error);
    } finally {
      leavingEdit = false;
    }
  }
  $effect(() => {
    const surface = pagedSurface;
    return () => {
      pagedHits = [];
      surface?.cancelCopy?.();
      surface?.cancelSelectionCopy?.();
      surface?.cancelRenderedSearch?.();
      surface?.cancelMarkerSource?.();
    };
  });
  // The tab owns negotiation across legacy/paged renderer changes. Keeping this
  // owner alive lets reconnect renegotiate an older daemon without a full reopen.
  $effect(() => {
    if (
      !selectedReadingSurface ||
      editState !== 'view' ||
      !$workspace ||
      !workspaceId ||
      !tab.noteId
    )
      return;
    const owner = { workspaceId, noteId: tab.noteId, panelId: tab.id };
    appStore.dispatch(pageResourceLimitsConfigured(selectedReadingSurface.resourceLimits));
    appStore.dispatch(pagePanelOpened(owner.workspaceId, owner.noteId, owner.panelId));
    return () => appStore.dispatch(pagePanelClosed(owner.workspaceId, owner.noteId, owner.panelId));
  });

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
    if (
      (selectedReadingSurface && editState !== 'view') ||
      pagedSurface ||
      !isActive ||
      !$workspace ||
      !noteId ||
      !noteContentStale ||
      contentLoadFailedNoteId === noteId
    )
      return;
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
  const showRenderedPreview = $derived(
    (noteViewMode === 'preview' || !$workspace) && !showSpecOnboarding,
  );

  const noteContentState = $derived.by<NoteContentState>(() => {
    if (!tab.noteId) return 'missing';
    if (!$note) return $notesState.loading || !$notesState.initialized ? 'loading' : 'missing';
    if (editState === 'loading') return 'loading';
    if (editState === 'error') return 'error';
    if (editState === 'editing') return 'editor';
    if (pagedSurface) return 'read-only';
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

  async function handleFullNoteOperation(
    kind: 'copy' | 'search' | 'selectAll',
    selection: Parameters<NoteReadingSurface['fullOperation']>[1],
  ) {
    const surface = pagedSurface;
    if (kind !== 'copy' || !surface?.copySelection) {
      surface?.fullOperation(kind, selection);
      return;
    }
    try {
      await surface.copySelection();
    } catch (error) {
      logger.error('Failed to copy note selection', error);
      noteCopyFeedback = m.ui_copyInput_copyFailed_ariaLabel();
    }
  }

  async function handleCopyNote() {
    if (!$note) return;
    try {
      if (pagedSurface) await pagedSurface.copyDocument();
      else await navigator.clipboard.writeText($note.content || '');
      noteCopyFeedback = m.layout_noteTab_copiedFullNote_label();
      if (noteCopyTimeoutId) clearTimeout(noteCopyTimeoutId);
      noteCopyTimeoutId = setTimeout(() => {
        noteCopyFeedback = null;
        noteCopyTimeoutId = null;
      }, 2000);
    } catch (error) {
      logger.error('Failed to copy note', error);
      noteCopyFeedback = m.ui_copyInput_copyFailed_ariaLabel();
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
      void deleteNote(workspaceId, noteIdToDelete);

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
                      void createNote(savedNote.workspaceId, {
                        title: savedNote.title,
                        content: savedNote.content,
                        contentType: savedNote.contentType,
                        tags: savedNote.tags,
                        parentId: savedNote.parentId,
                        visibility: savedNote.visibility,
                      });
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

  let presenceViewers = $state<RemoteNoteViewer[]>([]);

  // Viewing presence belongs to the visible tab, including raw/preview mode.
  // The lazy menu only renders this roster; the rich editor shares the lease.
  $effect(() => {
    if (!isActive || !showPresenceStack || !tab.noteId) return;
    const session = joinNotePresence(workspaceId, tab.noteId);
    presenceViewers = session.getViewers();
    const off = session.subscribe((next) => {
      presenceViewers = next;
    });
    return () => {
      off();
      session.release();
      presenceViewers = [];
    };
  });

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({
      display: noteDisplayActions,
      actions: noteActions,
      destructive: tab.noteId && !isSpecNote(tab.noteId) ? noteDestructiveActions : undefined,
    });
  });
</script>

{#snippet noteDisplayActions()}
  {#if tab.noteId}
    <NoteViewSettingsDropdown {workspaceId} noteId={tab.noteId} embedded />
  {/if}
{/snippet}

{#snippet noteActions()}
  {#if showPresenceStack && tab.noteId}
    <NotePresenceAvatarStack viewers={presenceViewers} embedded />
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

<NoteContentSurface state={noteContentState}>
  {#if tab.noteId}
    {#if selectedReadingSurface && $workspace}
      <div class="flex items-center gap-2 p-2">
        {#if editState === 'view'}
          <Button size="sm" onclick={startFullEdit} disabled={!noteEditable}>{m.menu_edit()}</Button
          >
        {:else if editState === 'editing'}
          <Button size="sm" onclick={finishFullEdit} disabled={leavingEdit}
            >{m.settings_devices_done_label()}</Button
          >
        {:else}
          <Button size="sm" variant="outline" onclick={cancelFullEdit}
            >{m.workspace_modals_cancel_label()}</Button
          >
        {/if}
      </div>
    {/if}
    {#if pagedSurface && showPagedFind}
      <PanelFindBar
        autofocus
        bind:query={pagedQuery}
        currentMatchIndex={pagedHitIndex}
        totalMatches={pagedHits.length}
        onInput={findPagedText}
        onPrevious={() => revealPagedHit(pagedHitIndex - 1)}
        onNext={() => revealPagedHit(pagedHitIndex + 1)}
        onClose={closePagedFind}
      />
      <p class="px-3 text-xs text-muted-foreground">{m.layout_noteTab_pagedFindLimit_label()}</p>
      {#if !pagedFindExact && pagedHits.length === 1000}<p class="px-3 text-xs">
          {m.layout_noteTab_pagedFindCapped_label()}
        </p>{/if}
      {#if pagedFindError}<p role="alert">{m.layout_noteTab_contentLoadFailed_error()}</p>{/if}
    {/if}
    {#if editState === 'loading'}
      <div role="status" aria-busy="true"><Skeleton class="h-8 w-3/4" /></div>
    {:else if editState === 'error'}
      <div role="alert">
        <p>{m.layout_noteTab_contentLoadFailed_error()}</p>
        <Button onclick={startFullEdit}>{m.ui_errorToast_retry_label()}</Button>
      </div>
    {:else if editState === 'editing' && $workspace}
      {#key workspaceId + ':' + tab.noteId}
        <NoteWithComments
          bind:this={fullEditor}
          workspace={$workspace}
          noteId={tab.noteId}
          editable={noteEditable}
          {isPanelFocused}
        />
      {/key}
    {:else if pagedSurface && $workspace}
      <NoteReadingView
        ownsPanel={false}
        {workspaceId}
        workspace={$workspace}
        noteId={tab.noteId}
        panelId={tab.id}
        onSelection={pagedSurface.selectionChanged}
        onFullOperation={handleFullNoteOperation}
        onReady={readingReady}
      />
    {:else if noteContentLoadFailed}
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

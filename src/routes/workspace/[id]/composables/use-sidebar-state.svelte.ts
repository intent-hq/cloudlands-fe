/**
 * useSidebarState Composable
 *
 * Manages sidebar state including activity events, notes, and code changes.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { untrack } from 'svelte';
import { handleLink } from '$features/navigation/link-handler';
import { selectCurrentStagedWorkingChanges, selectCurrentUnstagedWorkingChanges } from '$lib/store/slices/file-tracking/file-tracking-selectors';
import { selectAllNotes, selectNotesLoading } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
import { initializeNotes } from '$lib/store/slices/workspace-notes/workspace-notes-slice';
import { dispatch as reduxDispatch } from '$lib/store/redux-dispatch-bridge';
import {
  stageByPathRequested,
  unstageByPathRequested,
  revertChangeRequested,
} from '$lib/store/slices/file-tracking/file-tracking-slice';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { WorkspaceId } from '$shared/types/branded-ids';
import { selectWorkspaceEvents } from '$lib/store/slices/workspace-events/workspace-events-selectors';
import type { WorkspaceEvent } from '$features/events/types';
import type { TrackedChange } from '$features/file-tracking/types';
import type { Note, Workspace } from '$shared/types';
import type { WorkspacePageState, WorkspacePageStateManager } from './workspace-page-state.svelte';

export interface UseSidebarStateOptions {
  workspace: Workspace | null;
  workspaceState: WorkspacePageStateManager | null;
  state: WorkspacePageState | null;
}

export function useSidebarState(options: UseSidebarStateOptions) {
  // Always use panel layout (sleek sidebar)
  const useSleekSidebar = true;

  // Activity events for the sidebar preview
  let recentActivityEvents: WorkspaceEvent[] = $state([]);

  // Subscribe to notes from Redux store
  // (can't use $store syntax in .svelte.ts files)
  const reduxStore = getReduxStore();
  let _sidebarNotes = $state<Note[]>([]);
  let _sidebarNotesLoading = $state(false);
  $effect(() => {
    const wsId = options.workspace?.id;
    if (!wsId) {
      _sidebarNotes = [];
      _sidebarNotesLoading = false;
      return;
    }
    const notesStore = selectAllNotes.withStore(reduxStore)(wsId);
    const loadingStore = selectNotesLoading.withStore(reduxStore)(wsId);
    const unsub1 = notesStore.subscribe((value) => { _sidebarNotes = value; });
    const unsub2 = loadingStore.subscribe((value) => { _sidebarNotesLoading = value; });
    return () => { unsub1(); unsub2(); };
  });
  const sidebarNotes = $derived(_sidebarNotes);
  const sidebarNotesLoading = $derived(_sidebarNotesLoading);

  // Subscribe to working changes from Redux
  // (can't use $store syntax in .svelte.ts files)
  const ftStagedChanges$ = selectCurrentStagedWorkingChanges();
  const ftUnstagedChanges$ = selectCurrentUnstagedWorkingChanges();
  let _sidebarStagedChanges = $state<TrackedChange[]>(selectCurrentStagedWorkingChanges.select(getReduxStore().getState()));
  let _sidebarUnstagedChanges = $state<TrackedChange[]>(selectCurrentUnstagedWorkingChanges.select(getReduxStore().getState()));
  $effect(() => {
    const unsub1 = ftStagedChanges$.subscribe((value) => {
      _sidebarStagedChanges = value;
    });
    const unsub2 = ftUnstagedChanges$.subscribe((value) => {
      _sidebarUnstagedChanges = value;
    });
    return () => { unsub1(); unsub2(); };
  });
  const sidebarUnstagedChanges = $derived(_sidebarUnstagedChanges);
  const sidebarStagedChanges = $derived(_sidebarStagedChanges);

  // Get unique file paths from changes
  const sidebarFiles = $derived.by(() => {
    const fileSet = new Set<string>();
    for (const change of sidebarUnstagedChanges) {
      const path = change.relativePath || change.file;
      if (path) fileSet.add(path);
    }
    for (const change of sidebarStagedChanges) {
      const path = change.relativePath || change.file;
      if (path) fileSet.add(path);
    }
    return Array.from(fileSet).sort();
  });

  // Load recent activity events from Redux store
  $effect(() => {
    const workspace = options.workspace;
    if (!workspace?.id || !useSleekSidebar) return;
    const allEvents = selectWorkspaceEvents.select(getReduxStore().getState(), workspace.id);
    // Take the 10 most recent events (events are stored oldest-first, so slice from end)
    recentActivityEvents = allEvents.slice(-10).reverse();
  });

  // Initialize notes store when workspace is ready (needed for sidebar)
  let lastInitializedWorkspaceId: string | null = null;
  $effect(() => {
    const workspace = options.workspace;
    const state = options.state;
    if (workspace?.id && useSleekSidebar) {
      // Initialize if not already initialized for this workspace
      if (lastInitializedWorkspaceId !== workspace.id) {
        lastInitializedWorkspaceId = workspace.id;
        // Capture the selected note ID without creating a reactive dependency
        const selectedNoteId = untrack(() => state?.mainPanel.selectedNoteId);
        reduxDispatch(initializeNotes(
          workspace.id,
          selectedNoteId ?? undefined,
        ));
      }
    }
  });

  // Handlers
  function handleViewAllActivity() {
    options.workspaceState?.setMainPanel('activity');
  }

  function handleOpenActivityEvent(event: WorkspaceEvent) {
    options.workspaceState?.setMainPanel('activity', { selectedActivityEvent: event });
  }

  function handleOpenChange(change: TrackedChange) {
    options.workspaceState?.openDiff(change);
  }

  function handleAcceptChanges() {
    options.workspaceState?.openAcceptChanges();
  }

  async function handleStageChange(change: TrackedChange) {
    const filePath = change.relativePath || change.file;
    const wsId = getReduxStore().getState().workspace.activeWorkspaceId;
    if (filePath && wsId) {
      getReduxStore().dispatch(stageByPathRequested(wsId, [filePath]));
    }
  }

  async function handleUnstageChange(change: TrackedChange) {
    const filePath = change.relativePath || change.file;
    const wsId = getReduxStore().getState().workspace.activeWorkspaceId;
    if (filePath && wsId) {
      getReduxStore().dispatch(unstageByPathRequested(wsId, [filePath]));
    }
  }

  async function handleRevertChange(change: TrackedChange) {
    const { toast } = await import('svelte-sonner');
    // Use optimistic revert - UI updates immediately, toast shows right away
    toast.warning('Changes reverted');

    const wsId = getReduxStore().getState().workspace.activeWorkspaceId;
    if (!wsId) return;
    // Dispatch revert action - saga handles optimistic update + rollback on failure
    getReduxStore().dispatch(revertChangeRequested(wsId, change));
  }

  function handleOpenPR(url: string) {
    const wsId = options.workspace?.id;
    if (wsId) {
      handleLink(url, { workspaceId: WorkspaceId(wsId) });
    }
  }

  return {
    // State
    get useSleekSidebar() {
      return useSleekSidebar;
    },
    get recentActivityEvents() {
      return recentActivityEvents;
    },
    get sidebarNotes() {
      return sidebarNotes;
    },
    get sidebarNotesLoading() {
      return sidebarNotesLoading;
    },
    get sidebarUnstagedChanges() {
      return sidebarUnstagedChanges;
    },
    get sidebarStagedChanges() {
      return sidebarStagedChanges;
    },
    get sidebarFiles() {
      return sidebarFiles;
    },

    // Handlers
    handleViewAllActivity,
    handleOpenActivityEvent,
    handleOpenChange,
    handleAcceptChanges,
    handleStageChange,
    handleUnstageChange,
    handleRevertChange,
    handleOpenPR,
  };
}

/**
 * useSidebarState Composable
 *
 * Manages sidebar state including activity events, notes, and code changes.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { untrack } from 'svelte';
import { queryEvents, onEventCreated } from '$features/events/events.client';
import { getDeduplicationService } from '$features/events/event-deduplication.service';
import { handleLink } from '$features/navigation/link-handler';
import { notesStateManager } from '$features/notes/notes.store.svelte';
import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
import { WorkspaceId, NoteId } from '$shared/types/branded-ids';
import type { WorkspaceEvent } from '$features/events/types';
import type { TrackedChange } from '$features/file-tracking/types';
import type { Workspace } from '$shared/types';
import type {
  UnifiedWorkspaceState,
  createUnifiedWorkspaceState,
} from '$features/workspace/workspace-unified-state.svelte';

/** Type alias for the unified workspace state manager */
export type UnifiedWorkspaceStateManager = ReturnType<typeof createUnifiedWorkspaceState>;

export interface UseSidebarStateOptions {
  workspace: Workspace | null;
  workspaceState: UnifiedWorkspaceStateManager | null;
  state: UnifiedWorkspaceState | null;
}

export function useSidebarState(options: UseSidebarStateOptions) {
  // Always use panel layout (sleek sidebar)
  const useSleekSidebar = true;

  // Activity events for the sidebar preview
  let recentActivityEvents: WorkspaceEvent[] = $state([]);

  // Derived values for sidebar data
  const sidebarNotes = $derived.by(() => {
    const notesMap = notesStateManager.notes;
    return notesMap ? Array.from(notesMap.values()) : [];
  });

  const sidebarNotesLoading = $derived(notesStateManager.loading);

  const sidebarUnstagedChanges = $derived(fileTrackingStore.workingChanges.unstaged);
  const sidebarStagedChanges = $derived(fileTrackingStore.workingChanges.staged);

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

  // Load recent activity events when workspace is ready
  $effect(() => {
    const workspace = options.workspace;
    const deduplicationService = getDeduplicationService();
    if (workspace?.id && useSleekSidebar) {
      // Load initial events
      queryEvents(workspace.id, [], 10).then((events) => {
        // Track all initial events in deduplication service
        events.forEach((event) => deduplicationService.trackEvent(event));
        recentActivityEvents = events;
      });

      // Subscribe to new events
      const unsubscribe = onEventCreated(({ workspaceId, event }) => {
        if (workspaceId === workspace?.id) {
          // Check for duplicates before adding (content-based)
          if (deduplicationService.isDuplicate(event)) return;
          // Also check for duplicate event IDs to prevent {#each} key errors
          if (recentActivityEvents.some((e) => e.id === event.id)) return;
          // Add new event at the start and keep only 10 most recent
          recentActivityEvents = [event, ...recentActivityEvents].slice(0, 10);
        }
      });

      return () => {
        unsubscribe();
      };
    }
  });

  // Initialize notes store when workspace is ready (needed for sidebar)
  $effect(() => {
    const workspace = options.workspace;
    const state = options.state;
    if (workspace?.id && useSleekSidebar) {
      // Initialize if not already initialized for this workspace
      if (notesStateManager.workspaceId !== workspace.id) {
        // Capture the selected note ID without creating a reactive dependency
        const selectedNoteId = untrack(() => state?.mainPanel.selectedNoteId);
        notesStateManager.initialize(
          WorkspaceId(workspace.id),
          selectedNoteId ? NoteId(selectedNoteId) : undefined,
        );
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
    if (filePath) {
      await fileTrackingStore.stageByPath([filePath]);
    }
  }

  async function handleUnstageChange(change: TrackedChange) {
    const filePath = change.relativePath || change.file;
    if (filePath) {
      await fileTrackingStore.unstageByPath([filePath]);
    }
  }

  async function handleRevertChange(change: TrackedChange) {
    const { toast } = await import('svelte-sonner');
    // Use optimistic revert - UI updates immediately, toast shows right away
    toast.warning('Changes reverted');

    const result = await fileTrackingStore.revertChange(change);
    if (!result.ok) {
      // Show error toast - the UI will have already rolled back
      toast.error('Failed to revert changes');
    }
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

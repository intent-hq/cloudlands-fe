<script lang="ts">
  /**
   * HoveredSpaceDetails
   *
   * Component to display live status of a hovered workspace.
   * Shows task progress, file changes, and agent activity.
   *
   * Performance optimizations:
   * - Debounced fetch (150ms) to prevent IPC spam during rapid hover changes
   * - Shows cached data immediately while fetching fresh data
   * - Event subscriptions cleaned up on unmount
   */
  import { onMount, onDestroy } from 'svelte';
  import type { Note } from '$shared/types';
  import FlameGraph from './FlameGraph.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { spaceStatusClient } from '$features/workspace/space-status.client';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import type { SpaceLiveStatus } from '$features/workspace/space-status.types';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { goto } from '$app/navigation';

  // Debounce delay for hover fetches (ms)
  const FETCH_DEBOUNCE_MS = 150;

  interface Props {
    workspaceId: string;
    notes: Note[];
    notesLoading: boolean;
    onNavigate?: () => void;
  }

  let { workspaceId, notes, notesLoading, onNavigate }: Props = $props();

  // Live status from the backend
  let liveStatus: SpaceLiveStatus | null = $state(null);
  let statusLoading = $state(false);

  // Debounce timer for fetch
  let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Reactivity triggers for external services
  let streamsVersion = $state(0);
  let unreadVersion = $state(0);

  // Derived agent IDs from external trackers (for avatar display)
  const streamingAgentIds = $derived.by(() => {
    streamsVersion; // Trigger reactivity
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  });

  const unreadAgentIds = $derived.by(() => {
    unreadVersion; // Trigger reactivity
    return unreadTrackingService.getUnreadAgentIdsForWorkspace(workspaceId);
  });

  // Filter unread agents to exclude those that are currently streaming
  const unreadOnlyAgentIds = $derived.by(() => {
    return unreadAgentIds.filter((id) => !streamingAgentIds.includes(id));
  });

  // Load live status when workspaceId changes
  // Note: We use $effect here because we need async IPC calls, which $derived doesn't support.
  // The state mutation in loadLiveStatus is intentional for async data loading.
  $effect(() => {
    if (workspaceId) {
      // Show cached data immediately if available
      const cached = spaceStatusClient.getCached(workspaceId as WorkspaceId);
      if (cached) {
        liveStatus = cached;
      }

      // Clear any pending debounce timer
      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
      }

      // Debounce the IPC fetch to prevent spam during rapid hover changes
      fetchDebounceTimer = setTimeout(() => {
        loadLiveStatus(workspaceId);
      }, FETCH_DEBOUNCE_MS);
    }

    // Cleanup function for effect
    return () => {
      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = null;
      }
    };
  });

  async function loadLiveStatus(wsId: string) {
    statusLoading = true;
    try {
      const status = await spaceStatusClient.getStatus(wsId as WorkspaceId);
      // Only update if still viewing the same workspace
      if (workspaceId === wsId) {
        liveStatus = status;
      }
    } finally {
      statusLoading = false;
    }
  }

  // Subscribe to external trackers
  onMount(() => {
    const unsubStreams = activeStreamsTracker.subscribe(() => streamsVersion++);
    const unsubUnread = unreadTrackingService.subscribe(() => unreadVersion++);
    return () => {
      unsubStreams();
      unsubUnread();
    };
  });

  // Cleanup debounce timer on destroy
  onDestroy(() => {
    if (fetchDebounceTimer) {
      clearTimeout(fetchDebounceTimer);
    }
  });

  function handleNavigate() {
    onNavigate?.();
    goto(`/workspace/${workspaceId}`);
  }
</script>

{#if notesLoading && !notes.length}
  <div class="text-xs text-muted-foreground mt-2 animate-pulse">Loading...</div>
{:else if notes.length > 0}
  <!-- Flame Graph -->
  <div class="flex-1 shrink-0 flex mt-1">
    <FlameGraph
      {notes}
      onCellClick={handleNavigate}
      onCellHover={() => {}}
      onSpecClick={handleNavigate}
      hoveredNoteId={null}
      hasUnreadChanges={() => false}
    />
  </div>

  <!-- Status indicators row -->
  <div class="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
    <!-- Line changes badge -->
    {#if liveStatus?.lineStats && (liveStatus.lineStats.additions > 0 || liveStatus.lineStats.deletions > 0)}
      <LineChangesBadge
        additions={liveStatus.lineStats.additions}
        deletions={liveStatus.lineStats.deletions}
        size="xs"
      />
    {/if}

    <!-- Agent avatars with status -->
    {#if streamingAgentIds.length > 0 || unreadOnlyAgentIds.length > 0}
      <div class="flex items-center gap-1">
        {#each streamingAgentIds as agentId (agentId)}
          <AugieAvatarWithState {agentId} size={18} state="running" />
        {/each}
        {#each unreadOnlyAgentIds as agentId (agentId)}
          <AugieAvatarWithState {agentId} size={18} state="unread" />
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <!-- No notes case - show status indicators only -->
  <div class="text-xs text-muted-foreground mt-2 flex flex-wrap items-center gap-2">
    <!-- Line changes badge -->
    {#if liveStatus?.lineStats && (liveStatus.lineStats.additions > 0 || liveStatus.lineStats.deletions > 0)}
      <LineChangesBadge
        additions={liveStatus.lineStats.additions}
        deletions={liveStatus.lineStats.deletions}
        size="xs"
      />
    {/if}

    <!-- Agent avatars with status -->
    {#if streamingAgentIds.length > 0 || unreadOnlyAgentIds.length > 0}
      <div class="flex items-center gap-1">
        {#each streamingAgentIds as agentId (agentId)}
          <AugieAvatarWithState {agentId} size={18} state="running" />
        {/each}
        {#each unreadOnlyAgentIds as agentId (agentId)}
          <AugieAvatarWithState {agentId} size={18} state="unread" />
        {/each}
      </div>
    {/if}

    <!-- Fallback message when nothing to show -->
    {#if streamingAgentIds.length === 0 && unreadOnlyAgentIds.length === 0 && (!liveStatus?.lineStats || (liveStatus.lineStats.additions === 0 && liveStatus.lineStats.deletions === 0))}
      <span>Click to open this space</span>
    {/if}
  </div>
{/if}

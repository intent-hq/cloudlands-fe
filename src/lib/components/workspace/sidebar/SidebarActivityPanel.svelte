<script lang="ts">
  /**
   * SidebarActivityPanel - Compact activity timeline for sidebar
   * Shows workspace events in a sleek timeline format with comprehensive
   * event handling and natural language descriptions.
   */
  import { onMount, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
    faFile,
    faFileCirclePlus,
    faFileCircleMinus,
    faFileEdit,
    faArrowRightArrowLeft,
    faCodeBranch,
    faTerminal,
    faPlay,
    faCheck,
    faXmark,
    faWrench,
    faCircle,
    faMessage,
    faEye,
    faEyeSlash,
    faBell,
    faListCheck,
    faVial,
    faHammer,
    faComment,
    faPause,
    faRotate,
  } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { WorkspaceEvent } from '$features/events/types';
  import { queryEvents, onEventCreated, onEventsCleared } from '$features/events/events.client';
  import { getDeduplicationService } from '$features/events/event-deduplication.service';
  import {
    getActivityLabel,
    getActivityLabelParts,
    type StructuredLabel,
  } from '$features/events/activity-labels';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { faNote } from '$lib/icons/faNote';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';

  interface Props {
    workspaceId: string;
    /** Called when a file change event is clicked - receives the full event for showing changes */
    onOpenFileChanges?: (event: WorkspaceEvent) => void;
    onShowAgent?: (agentId: string) => void;
    onOpenNote?: (noteId: string) => void;
  }

  let { workspaceId, onOpenFileChanges, onShowAgent, onOpenNote }: Props = $props();

  // Subscribe to agent updates to get current agent names (not stale event.actor.name)
  const agentSubscription = useAllAgentsSubscription(() => workspaceId);

  // Build a reactive map of agent ID -> current name
  const agentNameMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const agent of agentSubscription.all) {
      if (agent.id && agent.name) {
        map.set(agent.id, agent.name);
      }
    }
    return map;
  });

  /**
   * Get the current agent name for an event's actor.
   * Looks up the agent's current name from the agent subscription,
   * falling back to the stored event.actor.name if the agent is no longer in the workspace.
   */
  function getCurrentActorName(event: WorkspaceEvent): string | undefined {
    const actorId = event.actor?.id;
    if (!actorId) return event.actor?.name;

    // Try to get current name from agent subscription
    const currentName = agentNameMap.get(actorId);
    if (currentName) return currentName;

    // Fall back to stored name (for historical events or deleted agents)
    return event.actor?.name;
  }

  let events: WorkspaceEvent[] = $state([]);
  let isLoading = $state(true);
  let previousWorkspaceId: string | undefined = $state(undefined);
  let subscriptionId: string | null = null;
  const deduplicationService = getDeduplicationService();

  /**
   * Generate a content-based key for deduplication.
   * Events with the same type, actor, and primary data (e.g. file path) within
   * a short time window are considered duplicates.
   */
  /**
   * Event types that should be hidden from the activity log.
   * These are internal state changes that aren't useful to show to users.
   */
  const HIDDEN_EVENT_TYPES = new Set([
    'agent:idle', // Internal state, not useful to show
    'agent:subscribed', // Internal subscription management
    'agent:unsubscribed', // Internal subscription management
    'agent:woken-by-subscription', // Internal wake-up event
  ]);

  /**
   * Check if an event should be hidden based on its type and data.
   * Some events are hidden based on their status (e.g., agent:status-changed with responding/streaming
   * is redundant with agent:started).
   */
  function shouldHideEvent(event: WorkspaceEvent): boolean {
    if (HIDDEN_EVENT_TYPES.has(event.type)) {
      return true;
    }

    // Hide agent:status-changed events when status is responding/streaming/thinking
    // These are redundant with agent:started events
    if (event.type === 'agent:status-changed') {
      const data = event.data as Record<string, unknown> | undefined;
      const status = data?.status || data?.newStatus;
      if (status === 'responding' || status === 'streaming' || status === 'thinking') {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the deduplication window for an event type.
   * Some events need longer windows to avoid showing duplicates.
   */
  function getDeduplicationWindow(eventType: string): number {
    // Agent completion/failure events should have a longer window
    // since the same agent completing multiple times in quick succession is noise
    if (eventType === 'agent:completed' || eventType === 'agent:failed') {
      return 30000; // 30 seconds
    }
    // Default window for most events
    return 2000; // 2 seconds
  }

  function getContentKey(event: WorkspaceEvent): string {
    const data = event.data as Record<string, unknown> | undefined;
    const parts: string[] = [event.type];

    // Add actor ID if present
    if (event.actor?.id) {
      parts.push(event.actor.id);
    }

    // Add primary identifiers based on event type
    if (event.type.startsWith('file:') && data?.path) {
      parts.push(String(data.path));
    } else if (event.type.startsWith('note:') && (data?.noteId || data?.id)) {
      parts.push(String(data.noteId || data.id));
    } else if (event.type.startsWith('agent:') && (data?.agentId || event.actor?.id)) {
      parts.push(String(data?.agentId || event.actor?.id || ''));
    } else if (event.type.startsWith('task:') && (data?.taskId || data?.noteId)) {
      parts.push(String(data.taskId || data.noteId));
    }

    return parts.join('::');
  }

  // Deduplicate events by both ID and content
  const dedupedEvents = $derived.by(() => {
    const seenIds = new Set<string>();
    const seenContent = new Map<string, number>(); // contentKey -> timestamp
    const deduped: WorkspaceEvent[] = [];

    for (const event of events) {
      // Skip hidden events (based on type and/or data)
      if (shouldHideEvent(event)) {
        continue;
      }

      // Skip if we've seen this exact ID
      if (event.id && seenIds.has(event.id)) {
        continue;
      }

      // Check for content-based duplicates within time window
      const contentKey = getContentKey(event);
      const eventTime = new Date(event.timestamp).getTime();
      const lastSeen = seenContent.get(contentKey);
      const dedupWindow = getDeduplicationWindow(event.type);

      if (lastSeen && eventTime - lastSeen < dedupWindow) {
        // Skip this duplicate, but update the timestamp
        seenContent.set(contentKey, eventTime);
        continue;
      }

      // Track this event
      if (event.id) {
        seenIds.add(event.id);
      }
      seenContent.set(contentKey, eventTime);
      deduped.push(event);
    }
    return deduped;
  });

  // Load events
  async function loadEvents(wsId: string) {
    isLoading = true;
    events = [];
    try {
      const initialEvents = await queryEvents(wsId, [], 1000);
      if (initialEvents.length > 0) {
        initialEvents.forEach((event) => deduplicationService.trackEvent(event));
        events = initialEvents;
      }
      const subId = `sidebar-activity-${wsId}-${Date.now()}`;
      await window.electronAPI
        .invoke('events:subscribe', { subscriptionId: subId, filters: [] })
        .catch(() => {});
      subscriptionId = subId;
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      isLoading = false;
    }
  }

  // Watch for workspace changes
  $effect(() => {
    const currentId = workspaceId;
    const prevId = untrack(() => previousWorkspaceId);
    if (currentId && currentId !== prevId) {
      if (prevId && subscriptionId) subscriptionId = null;
      untrack(() => {
        previousWorkspaceId = currentId;
      });
      loadEvents(currentId);
    }
  });

  // Real-time updates
  onMount(() => {
    const unsubUpdates = onEventCreated((data) => {
      if (data.workspaceId === workspaceId) {
        // Only require type to be present - actor may not exist for system events
        if (!data.event?.type) return;
        // NOTE: Do NOT call deduplicationService.isDuplicate() here.
        // The use-sidebar-state composable also listens on the same channel and calls
        // isDuplicate() first, which marks the event as "seen" in the shared singleton.
        // If we also call isDuplicate(), it returns true and silently drops the event.
        // The ID-based check below is sufficient to prevent duplicates.
        if (events.some((e) => e.id === data.event.id)) return;
        events = [data.event, ...events];
      }
    });
    const unsubCleared = onEventsCleared((clearedId) => {
      if (clearedId === workspaceId) events = [];
    });
    return () => {
      unsubUpdates();
      unsubCleared();
      if (subscriptionId) {
        window.electronAPI.invoke('events:unsubscribe', { subscriptionId }).catch(() => {});
        subscriptionId = null;
      }
    };
  });

  // Comprehensive icon mapping for all event types
  function getEventIcon(type: string): IconDefinition {
    // File events
    if (type === 'file:changed') return faFileEdit;
    if (type === 'file:created') return faFileCirclePlus;
    if (type === 'file:deleted') return faFileCircleMinus;
    if (type === 'file:renamed') return faArrowRightArrowLeft;

    // Note events
    if (type.startsWith('note:')) return faNote;

    // Git events
    if (type.startsWith('git:')) return faCodeBranch;

    // Terminal events
    if (type === 'terminal:command') return faTerminal;

    // Agent lifecycle events
    if (type === 'agent:started' || type === 'agent:created') return faPlay;
    if (type === 'agent:completed') return faCheck;
    if (type === 'agent:failed') return faXmark;
    if (type === 'agent:idle') return faPause;
    if (type === 'agent:deleted') return faXmark;
    if (type === 'agent:status-changed') return faRotate;
    if (type === 'agent:tool:call') return faWrench;

    // Agent messaging events
    if (
      type === 'agent:message' ||
      type === 'agent:message:sent' ||
      type === 'agent:message:received'
    )
      return faMessage;

    // Agent subscription events
    if (type === 'agent:subscribed') return faEye;
    if (type === 'agent:unsubscribed') return faEyeSlash;
    if (type === 'agent:woken-by-subscription') return faBell;

    // Task events
    if (type.startsWith('task:')) return faListCheck;

    // Test events
    if (type.startsWith('test:')) return faVial;

    // Build events
    if (type.startsWith('build:')) return faHammer;

    // Comment events
    if (type === 'comment:added') return faComment;

    // Workspace events
    if (type.startsWith('workspace:')) return faFile;

    // Spec/Goal events
    if (type === 'spec:updated' || type === 'goal:updated') return faNote;

    return faCircle;
  }

  // Status color based on event type and state
  function getStatusColor(event: WorkspaceEvent): string {
    const type = event.type;

    // Success states
    if (type === 'agent:completed') return 'text-emerald-500/70';
    if (type === 'test:completed') {
      const data = event.data as Record<string, unknown> | undefined;
      if (data?.status === 'passed') return 'text-emerald-500/70';
      if (data?.status === 'failed') return 'text-red-400/70';
    }
    if (type === 'build:completed') {
      const data = event.data as Record<string, unknown> | undefined;
      if (data?.status === 'success') return 'text-emerald-500/70';
      if (data?.status === 'failed') return 'text-red-400/70';
    }

    // Error states
    if (type === 'agent:failed') return 'text-red-400/70';
    if (type === 'agent:deleted') return 'text-muted-foreground/30';

    // Active/running states
    if (type === 'agent:started' || type === 'agent:created') return 'text-blue-400/70';
    if (type === 'agent:woken-by-subscription') return 'text-amber-400/70';

    // Messaging
    if (type === 'agent:message:sent' || type === 'agent:message:received')
      return 'text-purple-400/70';

    return 'text-muted-foreground/40';
  }

  // Get event label using the centralized activity label generator
  // Uses current agent names from the agent subscription instead of stale event.actor.name
  function getEventLabel(event: WorkspaceEvent): string {
    // Get the current actor name (may be different from stored event.actor.name if agent was renamed)
    const currentActorName = getCurrentActorName(event);

    // If we have a current name that's different from the stored one, create a modified event
    if (currentActorName && event.actor && currentActorName !== event.actor.name) {
      const eventWithCurrentName: WorkspaceEvent = {
        ...event,
        actor: {
          ...event.actor,
          name: currentActorName,
        },
      };
      return getActivityLabel(eventWithCurrentName);
    }

    return getActivityLabel(event);
  }

  // Get structured event label with styled parts for rich text rendering
  function getEventLabelParts(event: WorkspaceEvent): StructuredLabel {
    // Get the current actor name (may be different from stored event.actor.name if agent was renamed)
    const currentActorName = getCurrentActorName(event);

    // If we have a current name that's different from the stored one, create a modified event
    if (currentActorName && event.actor && currentActorName !== event.actor.name) {
      const eventWithCurrentName: WorkspaceEvent = {
        ...event,
        actor: {
          ...event.actor,
          name: currentActorName,
        },
      };
      return getActivityLabelParts(eventWithCurrentName);
    }

    return getActivityLabelParts(event);
  }

  // Get changes
  function getChanges(event: WorkspaceEvent): { additions: number; deletions: number } | null {
    const data = event.data as Record<string, unknown> | undefined;
    const cc = (event as { codeChange?: { additions?: number; deletions?: number } }).codeChange;
    const additions = (data?.additions as number) || cc?.additions || 0;
    const deletions = (data?.deletions as number) || cc?.deletions || 0;
    if (additions > 0 || deletions > 0) return { additions, deletions };
    return null;
  }

  function isAgentEvent(event: WorkspaceEvent): boolean {
    return event.actor?.type === 'agent' || event.actor?.type === 'external';
  }

  function isNoteEvent(event: WorkspaceEvent): boolean {
    return event.type.startsWith('note:');
  }

  // Get file path from event if it's a file event
  function getFilePath(event: WorkspaceEvent): string | null {
    if (!event.type.startsWith('file:')) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.path || data?.filePath || null) as string | null;
  }

  // Get note ID from event if it's a note event
  function getNoteId(event: WorkspaceEvent): string | null {
    if (!isNoteEvent(event)) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.noteId || data?.id || null) as string | null;
  }

  // Get task note ID from task events
  function getTaskNoteId(event: WorkspaceEvent): string | null {
    if (!event.type.startsWith('task:')) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.noteId || data?.linkedNoteId || null) as string | null;
  }

  // Handle click on an event - open the relevant content
  function handleEventClick(event: WorkspaceEvent) {
    // For file events, open the activity changes panel to show the diff
    const filePath = getFilePath(event);
    if (filePath && event.type.startsWith('file:')) {
      onOpenFileChanges?.(event);
      return;
    }

    // For agent events (including messaging/subscription), show the agent
    if (isAgentEvent(event) && event.actor?.id) {
      onShowAgent?.(event.actor.id);
      return;
    }

    // For note events, open the note
    const noteId = getNoteId(event);
    if (noteId) {
      onOpenNote?.(noteId);
      return;
    }

    // For task events, try to open the related note
    const taskNoteId = getTaskNoteId(event);
    if (taskNoteId) {
      onOpenNote?.(taskNoteId);
      return;
    }
  }

  // Check if event is clickable
  function isEventClickable(event: WorkspaceEvent): boolean {
    if (getFilePath(event)) return true;
    if (isAgentEvent(event) && event.actor?.id) return true;
    if (getNoteId(event)) return true;
    if (getTaskNoteId(event)) return true;
    return false;
  }
</script>

<div class="h-full flex flex-col">
  {#if isLoading}
    <!-- Loading skeleton -->
    <div class="px-5 py-3 space-y-3">
      {#each Array(6) as _, i (i)}
        <div class="flex items-center gap-2" style="animation-delay: {i * 50}ms">
          <Skeleton class="h-4 w-4 rounded shrink-0" />
          <Skeleton class="h-3 flex-1" />
          <Skeleton class="h-3 w-10" />
        </div>
      {/each}
    </div>
  {:else if dedupedEvents.length === 0}
    <!-- Empty state -->
    <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 py-8">
      <Fa icon={faFile} class="text-2xl mb-2 opacity-40" />
      <p class="text-[0.82rem]">No activity yet</p>
    </div>
  {:else}
    <!-- Timeline -->
    <div class="flex-1 overflow-y-auto px-5 py-2">
      <div class="relative">
        <!-- Vertical line -->
        {#if dedupedEvents.length > 1}
          <div class="absolute left-1.5 top-3 bottom-3 w-px bg-border z-0"></div>
        {/if}

        {#each dedupedEvents as event, index (event.id)}
          {@const icon = getEventIcon(event.type)}
          {@const labelParts = getEventLabelParts(event)}
          {@const statusColor = getStatusColor(event)}
          {@const changes = getChanges(event)}
          {@const isAgent = isAgentEvent(event)}
          {@const prevEvent = index > 0 ? dedupedEvents[index - 1] : null}
          {@const showTimestamp =
            !prevEvent ||
            Math.abs(
              new Date(event.timestamp).getTime() - new Date(prevEvent.timestamp).getTime(),
            ) > 60000}
          {@const clickable = isEventClickable(event)}

          <button
            type="button"
            class="relative group flex items-start gap-2 py-1 w-full text-left transition-colors z-10 {clickable
              ? 'cursor-pointer'
              : 'cursor-default'}"
            onclick={() => handleEventClick(event)}
            disabled={!clickable}
            transition:slide={{ axis: 'y', duration: 150 }}
          >
            <!-- Icon or Agent Avatar - use h-[1.2rem] to match text line-height for vertical centering -->
            <div class="relative flex items-center justify-center w-3.5 h-[1.2rem] shrink-0">
              {#if isAgent && event.actor?.id}
                <div class="flex items-center justify-center bg-sidebar">
                  <AuggieAvatar size={14} faceSeed={event.actor.id} colorSeed={event.actor.id} />
                </div>
              {:else}
                <div class="flex items-center justify-center w-3 rounded-sm bg-sidebar">
                  <Fa {icon} class="text-[10px] {statusColor}" />
                </div>
              {/if}
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0 flex items-baseline gap-1">
              <span
                class="text-[0.82rem] leading-[1.2rem] truncate text-muted-foreground {clickable
                  ? 'group-hover:text-foreground'
                  : ''} transition-colors"
              >
                {#each labelParts as part}{#if part.emphasis}<span
                      class="font-semibold text-foreground">{part.text}</span
                    >{:else}{part.text}{/if}{/each}
              </span>
              {#if changes}
                <LineChangesBadge
                  additions={changes.additions}
                  deletions={changes.deletions}
                  size="xs"
                />
              {/if}
            </div>

            <!-- Timestamp -->
            {#if showTimestamp}
              <span class="text-[10px] text-muted-foreground/40 shrink-0">
                <RelativeTime date={new Date(event.timestamp)} compact />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!--
  ActivityTimeline - Sleek timeline view for workspace activity

  Uses the same UI as the sandbox at /sandbox/activity-log
-->

<script lang="ts">
  import { Logger } from '$shared/logger';
  import type { WorkspaceEvent } from '../../events/types';
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
    faServer,
    faGlobe,
    faCamera,
  } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { onMount, untrack } from 'svelte';
  import { queryEvents, onEventCreated, onEventsCleared } from '../../events/events.client';
  import { getDeduplicationService } from '../../events/event-deduplication.service';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { slide } from 'svelte/transition';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import EntityChip from './EntityChip.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import {
    getFriendlyLabel,
    type EntityRef,
    type AgentNameResolver,
  } from '../utils/friendly-labels';
  import { faNote } from '$lib/icons/faNote';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  const logger = new Logger('ActivityTimeline');

  interface Props {
    workspaceId: string;
    handleFileSelect?: (path: string) => void;
    onShowAgent?: (agentId: string, event?: MouseEvent) => void;
    onOpenNote?: (noteId: string, event?: MouseEvent) => void;
  }

  let { workspaceId, handleFileSelect, onShowAgent, onOpenNote }: Props = $props();

  let events: WorkspaceEvent[] = $state([]);
  let expandedEventId: string | null = $state(null);
  let isLoading = $state(true);
  let previousWorkspaceId: string | undefined = $state(undefined);
  let subscriptionId: string | null = null;
  const deduplicationService = getDeduplicationService();

  // Create an agent name resolver that looks up agent names from the unified state store
  const agentNameResolver: AgentNameResolver = (agentId: string): string | undefined => {
    const agents = unifiedStateStore.getAgentsForWorkspace(workspaceId as WorkspaceId);
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name;
  };

  // Deduplicate events by ID to prevent Svelte {#each} key errors
  const dedupedEvents = $derived.by(() => {
    const seen = new Set<string>();
    const deduped: WorkspaceEvent[] = [];
    for (const event of events) {
      if (event.id && !seen.has(event.id)) {
        seen.add(event.id);
        deduped.push(event);
      }
    }
    return deduped;
  });

  // Load workspace events
  async function loadWorkspaceEvents(wsId: string) {
    isLoading = true;
    events = [];
    try {
      // Query events first (like the sidebar does)
      const initialEvents = await queryEvents(wsId, [], 1000);
      if (initialEvents.length > 0) {
        // Track all initial events in deduplication service to prevent duplicates from real-time updates
        initialEvents.forEach((event) => deduplicationService.trackEvent(event));
        // Merge with any real-time events that arrived during the async query
        // to avoid overwriting them
        const merged = [
          ...events.filter((e) => !initialEvents.some((ie) => ie.id === e.id)),
          ...initialEvents,
        ];
        events = merged;
      }

      // Set up subscription for real-time updates after query
      const subId = `activity-timeline-${wsId}-${Date.now()}`;
      await window.electronAPI
        .invoke('events:subscribe', { subscriptionId: subId, filters: [] })
        .catch(() => {
          // Subscribe failed - real-time updates won't work but historical events are still shown
        });
      subscriptionId = subId;
    } catch (error) {
      logger.error('[ActivityTimeline] Failed to load events:', error);
    } finally {
      isLoading = false;
    }
  }

  // Watch for workspace changes
  $effect(() => {
    const currentWorkspaceId = workspaceId;
    const prevId = untrack(() => previousWorkspaceId);
    if (currentWorkspaceId && currentWorkspaceId !== prevId) {
      if (prevId && subscriptionId) subscriptionId = null;
      untrack(() => {
        previousWorkspaceId = currentWorkspaceId;
      });
      loadWorkspaceEvents(currentWorkspaceId);
    }
  });

  // Real-time updates — uses onMount + onEventCreated (same pattern as SidebarActivityPanel)
  onMount(() => {
    const unsubUpdates = onEventCreated((data) => {
      if (data.workspaceId !== workspaceId) return;
      if (!data.event?.type) return;
      // Skip duplicates by ID (do NOT use deduplicationService — the sidebar
      // listener fires first and marks events as "seen", causing isDuplicate()
      // to return true here and silently drop every event)
      if (events.some((e) => e.id === data.event.id)) return;
      events = [data.event, ...events];
    });
    const unsubCleared = onEventsCleared((clearedWorkspaceId) => {
      if (clearedWorkspaceId === workspaceId) events = [];
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

  // Icon mapping (same as sandbox)
  function getEventIcon(type: WorkspaceEvent['type']): IconDefinition {
    const t = type as string;
    if (t === 'file:changed') return faFileEdit;
    if (t === 'file:created') return faFileCirclePlus;
    if (t === 'file:deleted') return faFileCircleMinus;
    if (t === 'file:renamed') return faArrowRightArrowLeft;
    if (t === 'note:created' || t === 'note:updated' || t === 'note:deleted') return faNote;
    if (t === 'git:commit' || t === 'git:push' || t === 'git:pull' || t === 'git:branch')
      return faCodeBranch;
    if (t === 'terminal:command') return faTerminal;
    if (t === 'agent:started' || t === 'agent:created') return faPlay;
    if (t === 'agent:completed') return faCheck;
    if (t === 'agent:failed') return faXmark;
    if (t === 'agent:tool:call') return faWrench;
    if (t === 'agent:idle' || t === 'agent:status-changed') return faCircle;
    if (t === 'agent:message' || t === 'agent:message:sent' || t === 'agent:message:received')
      return faCircle;
    // Task events
    if (t === 'task:status-changed') return faCheck;
    if (t === 'task:ready-tasks-changed') return faCheck;
    // Dev server events
    if (t === 'server:started' || t === 'dev-server:started') return faServer;
    if (t === 'server:stopped' || t === 'dev-server:stopped') return faServer;
    // Browser events
    if (t === 'browser:opened' || t === 'browser:tab-opened') return faGlobe;
    if (t === 'browser:screenshot') return faCamera;
    return faCircle;
  }

  function getEventStatus(event: WorkspaceEvent): 'success' | 'error' | 'neutral' {
    if (event.type === 'agent:completed') return 'success';
    if (event.type === 'agent:failed') return 'error';
    return 'neutral';
  }

  function isAgentEvent(event: WorkspaceEvent): boolean {
    return event.actor?.type === 'agent' || event.actor?.type === 'external';
  }

  function getChanges(event: WorkspaceEvent): { additions: number; deletions: number } | null {
    const data = event.data as any;
    const codeChange = (event as any).codeChange;
    const additions = data?.additions || codeChange?.additions || 0;
    const deletions = data?.deletions || codeChange?.deletions || 0;
    if (additions > 0 || deletions > 0) return { additions, deletions };
    return null;
  }

  /**
   * Open a file change event as a diff view by dispatching workspace:open-diff.
   * This is the standard pattern used by the rest of the app.
   */
  function openFileChangeDiff(filePath: string, wsEvent: WorkspaceEvent) {
    const data = wsEvent.data as Record<string, unknown> | undefined;
    window.dispatchEvent(
      new CustomEvent('workspace:open-diff', {
        detail: {
          filePath,
          change: {
            file: filePath,
            relativePath: filePath,
            ...data,
          },
        },
      }),
    );
  }

  function handleEntityClick(ref: EntityRef, wsEvent?: WorkspaceEvent) {
    if (ref.type === 'file' && ref.fullPath) {
      // For file change events, show the diff
      if (wsEvent && (wsEvent.type as string).startsWith('file:')) {
        openFileChangeDiff(ref.fullPath, wsEvent);
      } else {
        handleFileSelect?.(ref.fullPath);
      }
    } else if (ref.type === 'note' && ref.fullPath) {
      // fullPath contains the noteId for notes
      onOpenNote?.(ref.fullPath);
    } else if (ref.type === 'agent' && ref.fullPath) {
      // fullPath contains the agentId for agents
      onShowAgent?.(ref.fullPath);
    }
  }
</script>

<div class="h-full flex flex-col">
  <div class="flex-1 overflow-y-auto">
    {#if isLoading}
      <!-- Loading skeleton -->
      <div class="px-3 py-2 space-y-4">
        {#each Array(6) as _, i}
          <div class="flex items-start gap-3" style="animation-delay: {i * 50}ms">
            <Skeleton class="h-5 w-5 rounded-full shrink-0" />
            <div class="flex-1 space-y-1.5">
              <Skeleton class="h-4 w-[70%]" />
              <Skeleton class="h-3 w-[40%]" />
            </div>
          </div>
        {/each}
      </div>
    {:else if events.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-subtle py-8">
        <Fa icon={faFile} class="text-2xl mb-2 opacity-40" />
        <p class="text-sm">No activity yet</p>
      </div>
    {:else}
      <!-- Timeline (same as sandbox) -->
      <div class="relative mx-12 my-8">
        <!-- Continuous vertical connector line -->
        {#if dedupedEvents.length > 1}
          <div class="absolute left-[5.5px] top-5 bottom-5 w-px bg-border"></div>
        {/if}

        {#each dedupedEvents as event, index (event.id)}
          {@const label = getFriendlyLabel(event, agentNameResolver)}
          {@const status = getEventStatus(event)}
          {@const isAgent = isAgentEvent(event)}
          {@const changes = getChanges(event)}
          {@const isExpanded = expandedEventId === event.id}
          {@const eventIcon = getEventIcon(event.type)}
          {@const iconColor =
            status === 'success'
              ? 'text-emerald-500/80 dark:text-emerald-400/70'
              : status === 'error'
                ? 'text-red-400/80 dark:text-red-400/70'
                : 'text-ghost'}
          {@const prevEvent = index > 0 ? dedupedEvents[index - 1] : null}
          {@const thisTime = new Date(event.timestamp).getTime()}
          {@const prevTime = prevEvent ? new Date(prevEvent.timestamp).getTime() : 0}
          {@const showThisTimestamp = !prevEvent || Math.abs(thisTime - prevTime) > 60000}

          <div
            class="relative group flex items-start gap-2 py-1.5"
            transition:slide={{ duration: 200 }}
          >
            <!-- Timeline indicator (icon) with background to cover line -->
            <div class="relative flex items-center justify-center w-3 mt-[3.5px]">
              <div class="flex items-center justify-center w-4 h-4 rounded-sm bg-background">
                <Fa icon={eventIcon} class="text-xs {iconColor}" />
              </div>
            </div>

            <!-- Content -->
            <button
              class="flex-1 min-w-0 text-left group/item hover:bg-muted/30 rounded-md -ml-1 pl-1 py-0.5 transition-colors"
              onclick={(e) => {
                const eventType = event.type as string;
                // For agent events, navigate to the agent
                if (isAgent && event.actor?.id && onShowAgent) {
                  onShowAgent(event.actor.id, e);
                } else if (eventType.startsWith('file:')) {
                  // For file events, open the diff view
                  const data = event.data as Record<string, unknown> | undefined;
                  const filePath = (data?.path || data?.relativePath) as string | undefined;
                  if (filePath) {
                    openFileChangeDiff(filePath, event);
                  } else {
                    expandedEventId = isExpanded ? null : event.id;
                  }
                } else if (eventType.startsWith('note:')) {
                  // For note events, open the note
                  const data = event.data as Record<string, unknown> | undefined;
                  const noteId = (data?.noteId || data?.id) as string | undefined;
                  if (noteId && onOpenNote) {
                    onOpenNote(noteId, e);
                  } else {
                    expandedEventId = isExpanded ? null : event.id;
                  }
                } else {
                  // For other events, toggle expansion
                  expandedEventId = isExpanded ? null : event.id;
                }
              }}
            >
              <!-- Main label with timestamp on right -->
              <div class="flex items-center gap-1.5 leading-relaxed text-sm text-subtle">
                <div class="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  {#each label.parts as part, partIndex (`part-${partIndex}-${typeof part === 'string' ? 'text' : part.type}-${typeof part === 'string' ? part.slice(0, 20) : part.value}`)}
                    {#if typeof part === 'string'}
                      <span class="text-subtle">{part}</span>
                    {:else}
                      <EntityChip
                        type={part.type}
                        label={part.displayValue}
                        iconClass="text-ghost"
                        sublabel={part.fullPath}
                        variant="outline"
                        onClick={part.type !== 'text'
                          ? () => handleEntityClick(part, event)
                          : undefined}
                      />
                    {/if}
                  {/each}

                  {#if changes}
                    <LineChangesBadge additions={changes.additions} deletions={changes.deletions} />
                  {/if}
                </div>

                <!-- Timestamp on the right (only show if different from previous) -->
                {#if showThisTimestamp}
                  <span class="shrink-0 text-ui text-subtle ml-2">
                    <RelativeTime date={new Date(event.timestamp)} />
                  </span>
                {/if}
              </div>

              <!-- Expanded details -->
              {#if isExpanded}
                <div
                  class="mt-2 p-2 rounded-md bg-muted/40 text-xs font-mono text-subtle overflow-auto max-h-[40em] border border-border/50"
                  transition:slide={{ duration: 150 }}
                >
                  <pre>{JSON.stringify(event, null, 2)}</pre>
                </div>
              {/if}
            </button>

            <!-- Agent avatar -->
            {#if isAgent && event.actor?.id}
              <button
                type="button"
                class="shrink-0 -my-1 p-0.5 rounded-full hover:bg-muted/50 hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer"
                onclick={(e) => onShowAgent?.(event.actor.id!, e)}
                title="Open agent"
              >
                <AuggieAvatar size={24} faceSeed={event.actor.id} colorSeed={event.actor.id} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<script lang="ts">
  /**
   * AgentSubscriptions Component
   * Shows what events an agent is currently subscribed to as a sleek bottom row.
   * Also shows a brief "Woken up" indicator when an agent is woken by a subscription.
   *
   * PERF: Uses event-based updates instead of polling for better performance.
   * Listens for agent:subscribed, agent:unsubscribed, and agent:woken-by-subscription events.
   */
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import {
    faHourglass,
    faBell,
    faXmark,
    faChevronDown,
    faChevronRight,
    faStop,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createLogger } from '$lib/utils/client-logger';
  import { listenSync, extractEventData } from '$lib/electron-bridge';
  import Button from '$lib/components/ui/button/button.svelte';
  import AgentCard from './AgentCard.svelte';
  import InlineAgentAvatar from './InlineAgentAvatar.svelte';
  import { agentService } from '$features/agent/agent.service';

  const logger = createLogger('AgentSubscriptions');

  type AgentStatus = 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';

  interface Props {
    workspaceId: string;
    agentId: string;
  }

  interface DelegationGroupInfo {
    groupId: string;
    awaitMode: 'any' | 'all';
    expectedAgentIds: string[];
  }

  interface Subscription {
    id: string;
    agentId: string;
    eventTypes: string[];
    actorIds: string[];
    createdAt: string;
    description: string;
    delegationGroup?: DelegationGroupInfo;
  }

  interface DelegationGroupStatus {
    groupId: string;
    awaitMode: 'any' | 'all';
    expectedAgentIds: string[];
    completedAgentIds: string[];
    agentStatuses: Record<string, AgentStatus>;
  }

  interface WokenUpInfo {
    eventCount: number;
    eventTypes: string[];
    timestamp: number;
  }

  let { workspaceId, agentId }: Props = $props();

  // CRITICAL: Destruction flag to prevent async IPC callbacks from mutating state after unmount.
  // When the parent uses {#key} to force remount on workspace switch, the old instance is destroyed
  // but in-flight IPC responses (from loadSubscriptions) can still resolve and try to write to
  // $state variables. This flag is checked after every await to short-circuit stale responses.
  // Intentionally NOT $state — we read it without triggering reactive tracking.
  let isDestroyed = false;

  let subscriptions: Subscription[] = $state([]);
  let delegationGroups: DelegationGroupStatus[] = $state([]);
  let wokenUpInfo: WokenUpInfo | null = $state(null);
  let wokenUpTimeout: ReturnType<typeof setTimeout> | null = null;
  let isCollapsed: boolean = $state(false);
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let discoveryInterval: ReturnType<typeof setInterval> | null = null;
  let mountTime: number = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLoadAgentId: string | null = null;
  let lastLoadWorkspaceId: string | null = null;
  let discoveryStartTime: number = 0; // Track when discovery window started
  let discoveryMaxLifetimeReached: boolean = false; // Stops discovery polling only (never blocks snapshot fetch)
  let isStreamingAfterWake: boolean = false; // Blocks loadSubscriptions only while agent is actively streaming post-wake

  let lastDiscoveryRestartAt: number = 0; // Throttle restart storms from bursts of agent:created
  let wakeFailsafeTimeout: ReturnType<typeof setTimeout> | null = null; // Failsafe: clears isStreamingAfterWake if no clearing event arrives

  /**
   * Clear all pending timers (debounce, retry, wokenUp, wakeFailsafe).
   * Extracted to avoid duplication — the same cleanup is needed on wake, cancel,
   * stop-all, agentId change, and unmount.
   */
  function clearAllPendingTimers() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    if (wokenUpTimeout) {
      clearTimeout(wokenUpTimeout);
      wokenUpTimeout = null;
    }
    if (wakeFailsafeTimeout) {
      clearTimeout(wakeFailsafeTimeout);
      wakeFailsafeTimeout = null;
    }
  }

  /**
   * Clear the streaming-after-wake flag and woken-up indicator.
   * Called when the agent transitions out of streaming (idle, failed, completed, stopped).
   * Does NOT clear subscriptions — those are refreshed from the backend via loadSubscriptions().
   */
  function clearStreamingAndWakeState() {
    if (isStreamingAfterWake) {
      isStreamingAfterWake = false;
    }
    if (wakeFailsafeTimeout) {
      clearTimeout(wakeFailsafeTimeout);
      wakeFailsafeTimeout = null;
    }
    if (wokenUpInfo) {
      wokenUpInfo = null;
      if (wokenUpTimeout) {
        clearTimeout(wokenUpTimeout);
        wokenUpTimeout = null;
      }
    }
  }

  /**
   * Full state reset: clears subscriptions, delegation groups, woken-up indicator,
   * streaming-after-wake flag, all timers, and all polling.
   *
   * IMPORTANT: Every action that ends the "waiting" lifecycle (wake, cancel,
   * stop-all, agentId change, workspaceId change) MUST call this function.
   * The original subscription-UI-sticking bug was caused by these actions doing
   * inconsistent subsets of cleanup — some cleared subscriptions but not
   * isStreamingAfterWake, others cleared timers but not wokenUpInfo, etc.
   * Centralizing here prevents that class of bug from recurring.
   */
  function resetWaitingState() {
    subscriptions = [];
    delegationGroups = [];
    isStreamingAfterWake = false;
    wokenUpInfo = null;
    stopPolling();
    stopDiscoveryPolling();
    clearAllPendingTimers();
  }

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
  }

  // Derive two separate lists so delegation-group flows use the authoritative
  // source (delegationGroups[*].expectedAgentIds) instead of stale subscription actorIds.

  // 1. Agent IDs from active delegation groups (awaitMode === 'all').
  //    This is the authoritative source for "Waiting for all" flows.
  const delegationWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const group of delegationGroups) {
      if (group.awaitMode === 'all') {
        for (const id of group.expectedAgentIds) {
          ids.add(id);
        }
      }
    }
    return Array.from(ids);
  });

  // 2. Agent IDs from non-delegation subscriptions (watchers for arbitrary actorIds).
  //    Excludes subscriptions backed by an active delegation group with awaitMode='all'
  //    because those are already covered by delegationWatchedIds.
  const otherWatchedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const sub of subscriptions) {
      // Skip subscriptions that belong to an awaitMode='all' delegation group
      if (sub.delegationGroup?.awaitMode === 'all') continue;
      for (const actorId of sub.actorIds || []) {
        ids.add(actorId);
      }
    }
    return Array.from(ids);
  });

  // Combined list: union of both sets. Used for rendering and stopAllAgents().
  const watchedAgentIds = $derived.by(() => {
    const ids = new Set<string>([...delegationWatchedIds, ...otherWatchedIds]);
    return Array.from(ids);
  });

  // Determine the wait mode - 'all' if any subscription has after_all mode
  const waitMode = $derived.by(() => {
    for (const sub of subscriptions) {
      if (sub.delegationGroup?.awaitMode === 'all') {
        return 'all';
      }
    }
    return 'any';
  });

  // Get completion count for all mode
  const completionStatus = $derived.by(() => {
    let completed = 0;
    let total = 0;
    for (const group of delegationGroups) {
      if (group.awaitMode === 'all') {
        completed += group.completedAgentIds.length;
        total += group.expectedAgentIds.length;
      }
    }
    return { completed, total };
  });

  // Whether the subscription row should be visible (independent of wokenUpInfo).
  const showSubscriptionRow = $derived.by(() => {
    return (
      subscriptions.length > 0 &&
      (waitMode === 'all' || watchedAgentIds.length > 0) &&
      !(waitMode === 'all' && delegationGroups.length === 0) &&
      !(
        waitMode === 'all' &&
        completionStatus.total > 0 &&
        completionStatus.completed >= completionStatus.total
      )
    );
  });

  /**
   * Debounced wrapper: coalesces rapid-fire hint events into a single IPC call.
   */
  function requestLoadSubscriptions() {
    if (isDestroyed) return;
    // Don't fetch snapshots while the agent is actively streaming after wake.
    // We'll refetch once it returns to idle.
    if (isStreamingAfterWake) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      loadSubscriptions();
    }, 350);
  }

  async function loadSubscriptions(retryCount = 0) {
    if (isDestroyed) return;
    // Don't load subscriptions while agent is actively streaming after wake.
    // This prevents pending timers (debounce, double-tap, retry) from
    // re-populating subscriptions and re-showing the "Waiting for" UI.
    if (isStreamingAfterWake) return;

    // Capture prop values safely - they may throw if parent component's workspace is null
    let wsId: string | undefined;
    let aId: string | undefined;
    try {
      wsId = workspaceId;
      aId = agentId;
    } catch {
      // Props access threw - component is probably being unmounted
      return;
    }

    if (!wsId || !aId) return;

    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        const result = await (window as any).electronAPI.invoke('events:get-agent-subscriptions', {
          workspaceId: wsId,
          agentId: aId,
        });

        if (result?.success) {
          // DESTRUCTION GUARD: If the component was destroyed (e.g., {#key} remount on workspace switch)
          // while the IPC call was in flight, bail out to prevent writing to dead $state variables.
          if (isDestroyed) {
            logger.debug('Discarding IPC response — component destroyed during fetch', {
              agentId: aId,
            });
            return;
          }

          // POST-AWAIT GUARD: State may have changed while we were waiting for the IPC response.
          // If the agent was woken or agentId changed during the await, discard the stale response.
          // This prevents the exact bug where a wake event fires mid-IPC and clears subscriptions,
          // but the in-flight response then writes them back.
          if (isStreamingAfterWake) {
            logger.debug('Discarding stale IPC response — agent woken during fetch', {
              agentId: aId,
            });
            return;
          }
          if (wsId !== workspaceId) {
            logger.debug('Discarding stale IPC response — workspaceId changed during fetch', {
              fetchedFor: wsId,
              currentWorkspaceId: workspaceId,
            });
            return;
          }
          if (aId !== agentId) {
            logger.debug('Discarding stale IPC response — agentId changed during fetch', {
              fetchedFor: aId,
              currentAgentId: agentId,
            });
            return;
          }

          // VERSION GUARD: Discard responses from before the last wake event.
          // When an agent is woken, the subscription state changes (unsubscribe/cleanup).
          const newSubscriptions = result.data || [];
          const newDelegationGroups = result.delegationGroups || [];
          const prevCount = subscriptions.length;
          subscriptions = newSubscriptions;
          delegationGroups = newDelegationGroups;

          if (newSubscriptions.length > 0 || prevCount > 0) {
            logger.debug('loadSubscriptions snapshot applied', {
              agentId: aId,
              subscriptionCount: newSubscriptions.length,
              delegationGroupCount: newDelegationGroups.length,
              retryCount,
              agentStatuses: result.agentStatuses,
              elapsed: mountTime ? `${Math.round((Date.now() - mountTime) / 1000)}s` : 'n/a',
            });
          }

          // If we got data, manage polling lifecycle
          if (newSubscriptions.length > 0 || newDelegationGroups.length > 0) {
            // Clear retry timeout - we have data
            if (retryTimeout) {
              clearTimeout(retryTimeout);
              retryTimeout = null;
            }
            // Stop discovery polling - regular polling takes over
            stopDiscoveryPolling();
            startPolling();
          } else if (retryCount < 3) {
            // Still empty - retry with increasing delay to handle timing issues
            // after Vite reloads or race conditions during initial delegation
            const delay = Math.min(1000 * Math.pow(2, retryCount), 4000);
            logger.debug('Subscriptions empty, scheduling retry', {
              retryCount,
              delay,
              agentId: aId,
            });
            if (retryTimeout) clearTimeout(retryTimeout);
            retryTimeout = setTimeout(() => loadSubscriptions(retryCount + 1), delay);
          }
        } else {
          logger.warn('loadSubscriptions failed - backend returned failure', {
            result,
            agentId: aId,
          });
        }
      }
    } catch (error) {
      logger.warn('loadSubscriptions error', { error, agentId: aId, retryCount });
    }
  }

  function startPolling() {
    // Safety-net polling: periodically refresh subscription state to recover from
    // missed events (e.g., Vite page reloads destroying event listeners mid-stream)
    if (pollingInterval) return; // Already polling
    pollingInterval = setInterval(() => {
      if (subscriptions.length > 0 || delegationGroups.length > 0) {
        requestLoadSubscriptions();
      } else {
        // No subscriptions - stop polling
        stopPolling();
      }
    }, 10000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  /**
   * Dynamic discovery polling with convergence reconciliation.
   *
   * Behavior:
   * - Starts on mount (3s interval)
   * - Stops when subscriptions are found (regular polling takes over)
   * - Restarts when agent:created is received for a child agent (30s window)
   * - Immediate one-time fetch when agent:idle is received for THIS agent
   * - Stops permanently when agent starts responding to a wake event
   * - Max lifetime: 5 minutes (prevents infinite polling for orphaned agents)
   */
  function startDiscoveryPolling() {
    if (discoveryInterval) return;
    if (discoveryMaxLifetimeReached) return;
    if (isStreamingAfterWake) return;

    discoveryStartTime = Date.now();
    const DISCOVERY_WINDOW = 30000; // 30s window per discovery session
    const MAX_LIFETIME = 5 * 60 * 1000; // 5 minutes max total

    discoveryInterval = setInterval(() => {
      const elapsedSinceStart = Date.now() - mountTime;
      const elapsedSinceWindowStart = Date.now() - discoveryStartTime;

      // Check max lifetime (5 minutes from mount)
      if (elapsedSinceStart > MAX_LIFETIME) {
        logger.warn('Discovery max lifetime reached (5m), stopping discovery polling', { agentId });
        stopDiscoveryPolling();
        discoveryMaxLifetimeReached = true;
        return;
      }

      // Check current window (30s from window start)
      if (elapsedSinceWindowStart > DISCOVERY_WINDOW) {
        // Current discovery window expired
        logger.debug('Discovery window ended (30s), no subscriptions found', { agentId });
        stopDiscoveryPolling();
        return;
      }

      // Only poll if we don't already have subscriptions (if we do, regular polling handles it)
      if (subscriptions.length === 0 && delegationGroups.length === 0) {
        requestLoadSubscriptions();
      } else {
        // Found subscriptions during discovery - stop, regular polling takes over
        stopDiscoveryPolling();
      }
    }, 3000);
  }

  function stopDiscoveryPolling() {
    if (discoveryInterval) {
      clearInterval(discoveryInterval);
      discoveryInterval = null;
    }
  }

  /**
   * Restart discovery polling for a new 30s window.
   * Called when agent:created is received for a child agent.
   */
  function restartDiscoveryPolling() {
    if (discoveryMaxLifetimeReached) {
      logger.debug('Discovery max lifetime reached, not restarting discovery', { agentId });
      return;
    }
    if (isStreamingAfterWake) {
      logger.debug('Agent is streaming after wake, not restarting discovery', { agentId });
      return;
    }

    // Throttle restart storms from bursts of agent:created
    const now = Date.now();
    if (now - lastDiscoveryRestartAt < 2000) return;
    lastDiscoveryRestartAt = now;

    const elapsedSinceStart = Date.now() - mountTime;
    const MAX_LIFETIME = 5 * 60 * 1000; // 5 minutes max total

    if (elapsedSinceStart > MAX_LIFETIME) {
      discoveryMaxLifetimeReached = true;
      logger.warn('Max lifetime exceeded, not restarting discovery', { agentId });
      return;
    }

    logger.debug('Restarting discovery polling for new 30s window', { agentId });
    stopDiscoveryPolling();
    startDiscoveryPolling();
  }

  onMount(() => {
    mountTime = Date.now();
    logger.debug('Mounted', { agentId, workspaceId });

    // Initial load
    loadSubscriptions();

    // Start aggressive discovery polling for the first 30s
    // This ensures we catch subscriptions even if IPC events are missed
    startDiscoveryPolling();

    logger.info('AgentSubscriptions mounted, setting up event listeners', { agentId, workspaceId });

    // PERF: Subscribe to subscription change events instead of polling
    // This significantly reduces IPC traffic and CPU usage
    // Use listenSync for synchronous cleanup - no race conditions on unmount

    // Listen for agent subscription events
    // Uses extractEventData to handle both WorkspaceEvent (wrapped) and flat IPC formats
    const unsubSubscribed = listenSync('agent:subscribed', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      // Reload if the event is for our agent
      // Note: We always reload when eventAgentId === agentId because new subscriptions
      // won't be in watchedAgentIds() yet (they're added after reload)
      const eventAgentId = extractEventData<string>(event, 'agentId');
      logger.debug('agent:subscribed received', {
        eventAgentId,
        agentId,
        match: eventAgentId === agentId,
      });
      if (eventAgentId === agentId) {
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    const unsubUnsubscribed = listenSync('agent:unsubscribed', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const eventAgentId = extractEventData<string>(event, 'agentId');
      if (eventAgentId === agentId) {
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:idle events (when agents go idle/waiting)
    const unsubIdle = listenSync('agent:idle', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const eventAgentId = extractEventData<string>(event, 'agentId');
      if (eventAgentId === agentId) {
        clearStreamingAndWakeState();
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:status-changed events (when agents change status: idle -> responding, etc.)
    const unsubStatusChanged = listenSync('agent:status-changed', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const eventAgentId = extractEventData<string>(event, 'agentId');
      const status = extractEventData<string>(event, 'status');
      if (
        eventAgentId === agentId &&
        (status === 'idle' || status === 'failed' || status === 'completed')
      ) {
        clearStreamingAndWakeState();
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:stopped events (when sessions are cancelled/interrupted).
    // CRITICAL: This is the convergence path for cancellation. When a session is
    // stopped via stopSession(), the backend emits agent:stopped but does NOT emit
    // agent:status-changed (it sets status directly without going through
    // AgentEventSubscriptionService.setAgentStatus). Without this listener,
    // isStreamingAfterWake stays true after cancellation, permanently blocking
    // requestLoadSubscriptions() until the 30s failsafe kicks in.
    const unsubStopped = listenSync('agent:stopped', (event: any) => {
      // agent:stopped is a direct IPC event (flat format, no workspaceId).
      // It is broadcast to all windows, so we filter by agentId only.
      const eventAgentId = extractEventData<string>(event, 'agentId');
      if (eventAgentId === agentId) {
        logger.info(
          'agent:stopped received for this agent — clearing streaming state and refreshing',
          { agentId },
        );
        clearStreamingAndWakeState();
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:created events (when new delegated agents are created)
    const unsubCreated = listenSync('agent:created', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      // Check if this created agent is a child of this agent (delegated by this agent)
      // Event arrives in two shapes:
      //   1. Direct backend.emit() via setupEventForwarding: payload = { agentId, agent: { metadata: { createdByAgentId } } }
      //   2. WorkspaceEventBus broadcastToRenderer: payload = { type: 'agent:created', data: { createdByAgentId } }
      // Legacy code also checked parentAgentId; keep for backward compatibility.
      const payload = event?.payload ?? event;
      const creatorAgentId =
        payload?.agent?.metadata?.createdByAgentId ||
        payload?.data?.createdByAgentId ||
        payload?.agent?.metadata?.parentAgentId ||
        payload?.data?.parentAgentId;

      // Debug log: which field matched (aids future diagnosis)
      if (creatorAgentId === agentId) {
        const matchedField =
          payload?.agent?.metadata?.createdByAgentId === agentId
            ? 'agent.metadata.createdByAgentId'
            : payload?.data?.createdByAgentId === agentId
              ? 'data.createdByAgentId'
              : payload?.agent?.metadata?.parentAgentId === agentId
                ? 'agent.metadata.parentAgentId'
                : payload?.data?.parentAgentId === agentId
                  ? 'data.parentAgentId'
                  : 'unknown';
        logger.debug('Matched child agent via field', { matchedField });
      }

      if (creatorAgentId === agentId && !isStreamingAfterWake) {
        // This is a direct child - restart discovery polling for a new 30s window
        // to catch subscriptions that may be set up by the child agent
        // Skip if agent is streaming after wake
        logger.debug('Child agent created, restarting discovery polling', {
          agentId,
          childAgentId: payload?.agent?.id || payload?.data?.agentId,
        });
        restartDiscoveryPolling();
        requestLoadSubscriptions();
      } else if (subscriptions.length > 0 || delegationGroups.length > 0) {
        // Already have subscriptions - reload to update state
        requestLoadSubscriptions();
      }
    });

    // Single invalidation/hint event: always treat as snapshot refetch hint.
    const unsubSubscriptionsChanged = listenSync('agent:subscriptions-changed', (event: any) => {
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) return;

      const changedAgentId = extractEventData<string>(event, 'agentId');
      if (changedAgentId === agentId || watchedAgentIds.includes(changedAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // NOTE: We intentionally do NOT listen to agent:stream:${agentId} for content-blocks events.
    // Stream events have format { type: 'content-blocks', data: blocks, streamId, sessionId }
    // which extractEventData misidentifies as a WorkspaceEvent (because it has both `type` and
    // `data` properties), reading payload.data.type instead of payload.type. Additionally, the
    // channel would become stale if agentId changes while the component is mounted.
    // The other 6 event listeners + discovery polling already provide complete coverage.

    // Listen for agent:woken-by-subscription events to show a brief indicator
    const unsubWoken = listenSync('agent:woken-by-subscription', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const eventAgentId = extractEventData<string>(event, 'agentId');
      logger.debug('agent:woken-by-subscription received', {
        eventAgentId,
        agentId,
        match: eventAgentId === agentId,
      });
      if (eventAgentId === agentId) {
        // Check if the agent is CURRENTLY streaming before setting isStreamingAfterWake.
        // agent:woken-by-subscription is emitted AFTER sendBackendInitiatedMessage() returns
        // (i.e., after delivery success), which means the agent may have already finished
        // streaming and gone idle by the time this event arrives at the renderer.
        // If the agent is not streaming, setting isStreamingAfterWake=true would permanently
        // block loadSubscriptions() because no subsequent agent:idle/agent:status-changed
        // event will fire to clear it.
        const currentlyStreaming = agentService.isStreaming(agentId);

        // Full reset: clears subscriptions, delegationGroups, wokenUpInfo,
        // isStreamingAfterWake, all timers, and all polling.
        resetWaitingState();

        // Re-set isStreamingAfterWake AFTER reset if agent is actively streaming.
        // This blocks loadSubscriptions() until the agent goes idle, preventing
        // stale pre-wake snapshots from repopulating the "Waiting for" UI.
        if (currentlyStreaming) {
          isStreamingAfterWake = true;
        } else {
          logger.info(
            'agent:woken-by-subscription arrived but agent is not streaming — skipping isStreamingAfterWake',
            {
              agentId,
            },
          );
        }

        const eventData = extractEventData(event) || {};
        logger.info('Showing woken up indicator', { eventData, currentlyStreaming });
        // Show the woken up indicator
        wokenUpInfo = {
          eventCount: eventData.eventCount || 1,
          eventTypes: eventData.eventTypes || [],
          timestamp: Date.now(),
        };
        // Auto-hide after 4 seconds
        wokenUpTimeout = setTimeout(() => {
          wokenUpInfo = null;
        }, 4000);

        // FAILSAFE: If isStreamingAfterWake is true, set a bounded timer to clear it.
        // This prevents permanent stuck state if the clearing event (agent:idle,
        // agent:status-changed) is missed for any reason (e.g., event dropped, workspace
        // switch race, IPC failure). 30s is generous — most agent streams complete in <120s
        // and the clearing event should arrive within milliseconds of stream completion.
        if (isStreamingAfterWake) {
          wakeFailsafeTimeout = setTimeout(() => {
            wakeFailsafeTimeout = null;
            if (isStreamingAfterWake && !isDestroyed) {
              logger.warn(
                'Failsafe: clearing isStreamingAfterWake after 30s timeout — clearing event was missed',
                {
                  agentId,
                },
              );
              isStreamingAfterWake = false;
              requestLoadSubscriptions();
            }
          }, 30_000);
        }

        // No-op when not streaming: resetWaitingState() already cleared the UI.
        // Backend events (agent:subscriptions-changed) will trigger refresh when ready.
      } else {
        logger.info('Ignoring agent:woken-by-subscription event - not for this agent', {
          eventAgentId,
          agentId,
        });
      }
    });

    // Listen for agent:event-delivery-failed events to retract the woken-up banner
    const unsubDeliveryFailed = listenSync('agent:event-delivery-failed', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const targetAgentId = extractEventData<string>(event, 'targetAgentId');
      logger.debug('agent:event-delivery-failed received', {
        targetAgentId,
        agentId,
        match: targetAgentId === agentId,
      });
      if (targetAgentId === agentId) {
        // Delivery failed — agent did NOT actually wake/stream.
        logger.info('Retracting woken-up banner due to delivery failure', { targetAgentId });
        clearStreamingAndWakeState();
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:event-delivery-timeout events to clear the woken-up banner
    // Timeout means delivery status is unknown — NOT a hard failure.
    // Do NOT reset isStreamingAfterWake (timeout is ambiguous).
    // Do NOT call loadSubscriptions() — we don't know if the agent actually woke up.
    const unsubDeliveryTimeout = listenSync('agent:event-delivery-timeout', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const targetAgentId = extractEventData<string>(event, 'targetAgentId');
      logger.debug('agent:event-delivery-timeout received', {
        targetAgentId,
        agentId,
        match: targetAgentId === agentId,
      });
      if (targetAgentId === agentId) {
        // Delivery timed out for this agent - clear the woken-up banner if shown
        // but do NOT reset isStreamingAfterWake or reload subscriptions.
        // Timeout is ambiguous: the agent may or may not have received the events.
        logger.info('Clearing woken-up banner due to delivery timeout', { targetAgentId });
        wokenUpInfo = null;
        if (wokenUpTimeout) {
          clearTimeout(wokenUpTimeout);
          wokenUpTimeout = null;
        }
      }
    });

    // Listen for agent:subscriptions-restored events (batch restoration on startup)
    const unsubSubscriptionsRestored = listenSync('agent:subscriptions-restored', (event: any) => {
      // Workspace-scoped filtering: skip events from other workspaces
      const eventWorkspaceId =
        extractEventData<string>(event, 'workspaceId') || event?.payload?.workspaceId;
      if (eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        // Event is from a different workspace - skip it
        return;
      }

      const eventData = extractEventData(event) || {};
      const restoredAgentIds = eventData.agentIds || [];
      logger.debug('agent:subscriptions-restored received', {
        count: eventData.count,
        restoredAgentIds,
        agentId,
        isRelevant: restoredAgentIds.includes(agentId),
      });

      // Reload subscriptions if this agent or any watched agents had subscriptions restored
      if (
        restoredAgentIds.includes(agentId) ||
        restoredAgentIds.some((id: string) => watchedAgentIds.includes(id))
      ) {
        requestLoadSubscriptions();
      }
    });

    logger.info('Event listeners set up successfully', { agentId });

    // Return cleanup function for onMount
    return () => {
      // CRITICAL: Set destruction flag FIRST, before any other cleanup.
      // This prevents in-flight async IPC responses from mutating $state after unmount.
      isDestroyed = true;
      logger.debug('Unmounting', { agentId, workspaceId });
      unsubSubscribed();
      unsubUnsubscribed();
      unsubIdle();
      unsubStatusChanged();
      unsubStopped();
      unsubCreated();
      unsubSubscriptionsChanged();
      unsubWoken();
      unsubDeliveryFailed();
      unsubDeliveryTimeout();
      unsubSubscriptionsRestored();
      stopPolling();
      stopDiscoveryPolling();
      clearAllPendingTimers();
    };
  });

  // Reload when agentId changes (but not on initial mount — onMount handles that)
  $effect(() => {
    if (agentId && lastLoadAgentId !== null && agentId !== lastLoadAgentId) {
      logger.debug('agentId changed, reloading', { from: lastLoadAgentId, to: agentId });
      resetWaitingState();
      discoveryMaxLifetimeReached = false;
      lastDiscoveryRestartAt = 0;
      mountTime = Date.now();
      startDiscoveryPolling();
      loadSubscriptions();
    }
    lastLoadAgentId = agentId;
  });

  // Reset when workspaceId changes (prevents stale state from previous workspace)
  $effect(() => {
    if (workspaceId && lastLoadWorkspaceId !== null && workspaceId !== lastLoadWorkspaceId) {
      logger.debug('workspaceId changed, clearing stale state', {
        from: lastLoadWorkspaceId,
        to: workspaceId,
      });
      resetWaitingState();
      discoveryMaxLifetimeReached = false;
      lastDiscoveryRestartAt = 0;
      mountTime = Date.now();
      startDiscoveryPolling();
      loadSubscriptions();
    }
    lastLoadWorkspaceId = workspaceId;
  });

  async function cancelSubscriptions() {
    if (!workspaceId || !agentId) return;

    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        // Cancel all agent event subscriptions for this agent on the backend
        // This uses the AgentEventSubscriptionService.unsubscribeAll() method
        // which properly removes the subscriptions that trigger wake-ups
        await (window as any).electronAPI.invoke('events:unsubscribe-agent', {
          workspaceId,
          agentId,
        });
        resetWaitingState();
      }
    } catch (error) {
      logger.error('Failed to cancel subscriptions', { error });
      resetWaitingState(); // Still clear UI even if backend fails
    }
  }

  async function stopAllAgents() {
    if (!workspaceId || !agentId) return;

    try {
      // Capture agent IDs before resetting state (which clears watchedAgentIds)
      const agentIdsToStop = [...watchedAgentIds];

      // CRITICAL: Cancel subscriptions on the backend FIRST, before stopping any agents
      // This ensures the subscription service won't queue wake-up events when agents stop
      await (window as any).electronAPI.invoke('events:unsubscribe-agent', {
        workspaceId,
        agentId,
      });

      resetWaitingState();

      // Stop the parent agent to prevent it from responding to any in-flight wake-up events
      await agentService.stopSession(agentId);

      // Then stop all watched agents
      await Promise.all(agentIdsToStop.map((id) => agentService.stopSession(id)));
    } catch (error) {
      logger.error('Failed to stop all agents', { error });
    }
  }
</script>

{#if wokenUpInfo && !showSubscriptionRow}
  <!-- Standalone woken-up indicator: shown only when no subscription row is active -->
  <div
    class="flex items-end gap-2 px-4.5 py-1.5 text-ui text-subtle font-family-child"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root delayDuration={0}>
        <Tooltip.Trigger>
          <div class="shrink-0 flex items-center pb-1 gap-2 text-subtle">
            <Fa icon={faBell} size="xs" />
            <span>Woken up</span>
            <span class="text-subtle">
              ({wokenUpInfo.eventCount}
              {wokenUpInfo.eventCount === 1 ? 'event' : 'events'})
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" class="text-xs">
          <p>Agent was woken by subscription events:</p>
          <ul class="mt-1 text-subtle">
            {#each wokenUpInfo.eventTypes as eventType, i (`eventType-${i}-${eventType}`)}
              <li>• {eventType}</li>
            {/each}
          </ul>
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  </div>
{/if}

{#if showSubscriptionRow}
  <div class="w-full font-family-child">
    <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-subtle">
      <!-- Collapse/expand toggle with wait mode indicator -->
      <button
        type="button"
        class="shrink-0 flex items-center gap-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
        onclick={toggleCollapsed}
      >
        <Fa icon={isCollapsed ? faChevronRight : faChevronDown} class="w-2.5! h-2.5!" />
      </button>

      <!-- Wait mode indicator - clickable to toggle collapse/expand -->
      {#if waitMode === 'all'}
        <button
          type="button"
          class="shrink-0 flex items-center gap-2 whitespace-nowrap cursor-pointer hover:text-muted-foreground transition-colors"
          onclick={toggleCollapsed}
        >
          <Fa icon={faHourglass} size="13" />
          Waiting for all
          {#if completionStatus.total > 0}
            <span class="text-subtle">
              ({completionStatus.completed}/{completionStatus.total})
            </span>
          {/if}
        </button>
      {:else}
        <button
          type="button"
          class="shrink-0 cursor-pointer hover:text-muted-foreground transition-colors"
          onclick={toggleCollapsed}
        >
          Waiting for {watchedAgentIds.length} agent{watchedAgentIds.length === 1 ? '' : 's'}
        </button>
      {/if}

      <!-- Inline "Woken up" pill inside the subscription row -->
      {#if wokenUpInfo}
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root delayDuration={0}>
            <Tooltip.Trigger>
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-ui text-subtle bg-muted/50"
                transition:fade={{ duration: 200 }}
              >
                <Fa icon={faBell} size="xs" />
                Woken up
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="text-xs">
              <p>
                Agent was woken by {wokenUpInfo.eventCount}
                {wokenUpInfo.eventCount === 1 ? 'event' : 'events'}:
              </p>
              <ul class="mt-1 text-subtle">
                {#each wokenUpInfo.eventTypes as eventType, i (`eventType-${i}-${eventType}`)}
                  <li>• {eventType}</li>
                {/each}
              </ul>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}

      <!-- Inline agent avatars when collapsed -->
      {#if isCollapsed}
        <div class="flex items-center -space-x-1.5">
          {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
            <InlineAgentAvatar agentId={watchedAgentId} />
          {/each}
          {#if watchedAgentIds.length > 5}
            <span class="text-ui text-subtle pl-2">
              +{watchedAgentIds.length - 5}
            </span>
          {/if}
        </div>
      {/if}

      <!-- Action buttons -->
      <div class="flex-1"></div>
      <!-- Provider ensures proper context and cleanup during component destruction -->
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger>
            <Button
              variant="ghost-light"
              size="icon-xs"
              onclick={stopAllAgents}
              class="text-ghost hover:text-muted-foreground/70"
            >
              <Fa icon={faStop} class="w-2.5! h-2.5!" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side="top" class="text-xs">
            <p>Stop all agents</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
      <!-- Provider ensures proper context and cleanup during component destruction -->
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger>
            <Button
              variant="ghost-light"
              size="icon-xs"
              onclick={cancelSubscriptions}
              class="text-ghost hover:text-muted-foreground/70"
            >
              <Fa icon={faXmark} class="w-2.5! h-2.5!" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side="top" class="text-xs">
            <p>Cancel subscription</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
  </div>

  <!-- Agent cards with streaming last message - shown when expanded -->
  {#if !isCollapsed}
    <div
      class="flex flex-col gap-0.5 w-full pl-4.5 pr-2 font-family-child"
      transition:slide={{ duration: 150 }}
    >
      {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
        <div class="w-full" transition:slide={{ axis: 'y', duration: 200 }}>
          <AgentCard agentId={watchedAgentId} />
        </div>
      {/each}
      {#if watchedAgentIds.length > 5}
        <div class="text-ui text-subtle text-center py-1">
          +{watchedAgentIds.length - 5} more agents
        </div>
      {/if}
    </div>
  {/if}
{/if}

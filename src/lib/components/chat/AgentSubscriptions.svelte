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
  import { faHourglass, faBell, faXmark, faChevronDown, faChevronRight, faStop } from '@fortawesome/free-solid-svg-icons';
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

  function toggleCollapsed() {
    isCollapsed = !isCollapsed;
  }

  // Get unique agent IDs being watched across all subscriptions
  const watchedAgentIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const sub of subscriptions) {
      for (const actorId of sub.actorIds || []) {
        ids.add(actorId);
      }
    }
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

  /**
   * Debounced wrapper: coalesces rapid-fire event triggers into a single IPC call.
   * Multiple events (subscribed, created, idle, status-changed) can fire within ms of
   * each other — without debounce this produces 10+ redundant IPC calls.
   */
  function requestLoadSubscriptions() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      loadSubscriptions();
    }, 150);
  }

  async function loadSubscriptions(retryCount = 0) {
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
          const newSubscriptions = result.data || [];
          const newDelegationGroups = result.delegationGroups || [];
          const prevCount = subscriptions.length;
          subscriptions = newSubscriptions;
          delegationGroups = newDelegationGroups;

          // Use console.warn for visibility in DevTools (logger.info is often filtered out)
          if (newSubscriptions.length > 0 || prevCount > 0) {
            console.warn('[AgentSubscriptions] loadSubscriptions:', {
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
            logger.debug('Subscriptions empty, scheduling retry', { retryCount, delay, agentId: aId });
            if (retryTimeout) clearTimeout(retryTimeout);
            retryTimeout = setTimeout(() => loadSubscriptions(retryCount + 1), delay);
          }
        } else {
          console.warn('[AgentSubscriptions] loadSubscriptions FAILED - backend returned failure', {
            result,
            agentId: aId,
          });
        }
      }
    } catch (error) {
      console.warn('[AgentSubscriptions] loadSubscriptions ERROR', { error, agentId: aId, retryCount });
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
   * Aggressive discovery polling for the first 30s after mount.
   * This catches subscriptions regardless of IPC event timing.
   * Runs every 3s until subscriptions are found or the window expires.
   */
  function startDiscoveryPolling() {
    if (discoveryInterval) return;
    discoveryInterval = setInterval(() => {
      const elapsed = Date.now() - mountTime;
      if (elapsed > 30000) {
        // Discovery period over
        console.warn('[AgentSubscriptions] Discovery period ended (30s), no subscriptions found', { agentId });
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

  onMount(() => {
    mountTime = Date.now();
    console.warn('[AgentSubscriptions] MOUNTED', { agentId, workspaceId });

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
      // Reload if the event is for our agent
      // Note: We always reload when eventAgentId === agentId because new subscriptions
      // won't be in watchedAgentIds() yet (they're added after reload)
      const eventAgentId = extractEventData<string>(event, 'agentId');
      console.warn('[AgentSubscriptions] agent:subscribed event received', { eventAgentId, agentId, match: eventAgentId === agentId });
      if (eventAgentId === agentId) {
        // This agent created a new subscription - always reload
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    const unsubUnsubscribed = listenSync('agent:unsubscribed', (event: any) => {
      const eventAgentId = extractEventData<string>(event, 'agentId');
      if (eventAgentId === agentId || watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:idle events (when agents go idle/waiting)
    const unsubIdle = listenSync('agent:idle', (event: any) => {
      const eventAgentId = extractEventData<string>(event, 'agentId');
      if (eventAgentId === agentId) {
        // THIS agent went idle — it may have just finished setting up delegations.
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:status-changed events (when agents change status: idle -> responding, etc.)
    const unsubStatusChanged = listenSync('agent:status-changed', (event: any) => {
      const eventAgentId = extractEventData<string>(event, 'agentId');
      const status = extractEventData<string>(event, 'status');
      if (eventAgentId === agentId && status === 'idle') {
        // THIS agent became idle — check for subscriptions (same rationale as agent:idle above)
        requestLoadSubscriptions();
      } else if (watchedAgentIds.includes(eventAgentId)) {
        requestLoadSubscriptions();
      }
    });

    // Listen for agent:created events (when new delegated agents are created)
    const unsubCreated = listenSync('agent:created', (event: any) => {
      // Check if this created agent is a child of this agent (delegated by this agent)
      // The event from setupEventForwarding includes agent.metadata.parentAgentId
      const payload = event?.payload ?? event;
      const parentAgentId =
        payload?.agent?.metadata?.parentAgentId ||
        payload?.data?.parentAgentId;

      if (parentAgentId === agentId) {
        // This is a direct child - always reload to pick up the new delegation
        requestLoadSubscriptions();
      } else if (subscriptions.length > 0 || delegationGroups.length > 0) {
        // Already have subscriptions - reload to update state
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
      const eventAgentId = extractEventData<string>(event, 'agentId');
      console.warn('[AgentSubscriptions] agent:woken-by-subscription event received', {
        eventAgentId,
        agentId,
        match: eventAgentId === agentId,
      });
      if (eventAgentId === agentId) {
        const eventData = extractEventData(event) || {};
        logger.info('Showing woken up indicator', { eventData });
        // Show the woken up indicator
        wokenUpInfo = {
          eventCount: eventData.eventCount || 1,
          eventTypes: eventData.eventTypes || [],
          timestamp: Date.now(),
        };
        // Clear any existing timeout
        if (wokenUpTimeout) {
          clearTimeout(wokenUpTimeout);
        }
        // Auto-hide after 4 seconds
        wokenUpTimeout = setTimeout(() => {
          wokenUpInfo = null;
        }, 4000);
      } else {
        logger.info('Ignoring agent:woken-by-subscription event - not for this agent', {
          eventAgentId,
          agentId,
        });
      }
    });

    logger.info('Event listeners set up successfully', { agentId });

    // Return cleanup function for onMount
    return () => {
      console.warn('[AgentSubscriptions] UNMOUNTING', { agentId, workspaceId });
      unsubSubscribed();
      unsubUnsubscribed();
      unsubIdle();
      unsubStatusChanged();
      unsubCreated();
      unsubWoken();
      stopPolling();
      stopDiscoveryPolling();
      // Clean up retry timeout
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      // Clean up debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // Clean up woken up timeout
      if (wokenUpTimeout) {
        clearTimeout(wokenUpTimeout);
      }
    };
  });

  // Reload when agentId changes (but not on initial mount — onMount handles that)
  $effect(() => {
    if (agentId && lastLoadAgentId !== null && agentId !== lastLoadAgentId) {
      console.warn('[AgentSubscriptions] agentId changed, reloading', { from: lastLoadAgentId, to: agentId });
      // Clear stale state from previous agent immediately so UI doesn't flash old data
      subscriptions = [];
      delegationGroups = [];
      wokenUpInfo = null;
      // Cancel any pending debounce from the old agent's events
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // Stop all old timers and restart for the new agent
      stopPolling();
      stopDiscoveryPolling();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      mountTime = Date.now();
      startDiscoveryPolling();
      loadSubscriptions();
    }
    lastLoadAgentId = agentId;
  });

  /**
   * Scroll to the message where this agent subscribed (tool call that created the subscription)
   */
  function scrollToSubscriptionSource() {
    // Dispatch event that ChatPanel will handle
    // We pass the subscription info so ChatPanel can find the right message
    window.dispatchEvent(
      new CustomEvent('agent:scroll-to-subscription', {
        detail: {
          agentId,
          subscriptions: subscriptions.map((s) => ({
            id: s.id,
            eventTypes: s.eventTypes,
            createdAt: s.createdAt,
          })),
        },
      }),
    );
  }

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
        // Clear local state and all timers for snappy UI
        subscriptions = [];
        delegationGroups = [];
        stopPolling();
        stopDiscoveryPolling();
        if (retryTimeout) {
          clearTimeout(retryTimeout);
          retryTimeout = null;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
      }
    } catch (error) {
      logger.error('Failed to cancel subscriptions', { error });
    }
  }

  async function stopAllAgents() {
    if (!workspaceId || !agentId) return;

    try {
      // Capture agent IDs before canceling subscriptions (which clears the list)
      const agentIdsToStop = [...watchedAgentIds];

      // CRITICAL: Cancel subscriptions on the backend FIRST, before stopping any agents
      // This ensures the subscription service won't queue wake-up events when agents stop
      await (window as any).electronAPI.invoke('events:unsubscribe-agent', {
        workspaceId,
        agentId,
      });

      // Clear local state and all timers
      subscriptions = [];
      delegationGroups = [];
      stopPolling();
      stopDiscoveryPolling();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      // Stop the parent agent to prevent it from responding to any in-flight wake-up events
      await agentService.stopSession(agentId);

      // Then stop all watched agents
      await Promise.all(agentIdsToStop.map((id) => agentService.stopSession(id)));
    } catch (error) {
      logger.error('Failed to stop all agents', { error });
    }
  }
</script>

{#if wokenUpInfo}
  <!-- Woken up indicator - shows briefly when agent is woken by subscription -->
  <div
    class="flex items-end gap-2 px-4.5 py-1.5 text-[11px] text-muted-foreground/60 font-family-child"
    transition:fade={{ duration: 200 }}
  >
    <!-- Provider ensures proper context and cleanup during component destruction -->
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root delayDuration={0}>
        <Tooltip.Trigger>
          <div class="shrink-0 flex items-center pb-1 gap-2 text-green-500/80">
            <Fa icon={faBell} size="xs" />
            <span>Woken up</span>
            <span class="text-muted-foreground/40">
              ({wokenUpInfo.eventCount}
              {wokenUpInfo.eventCount === 1 ? 'event' : 'events'})
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" class="text-xs">
          <p>Agent was woken by subscription events:</p>
          <ul class="mt-1 text-muted-foreground/80">
            {#each wokenUpInfo.eventTypes as eventType, i (`eventType-${i}-${eventType}`)}
              <li>• {eventType}</li>
            {/each}
          </ul>
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  </div>
{:else if subscriptions.length > 0 && (waitMode === 'all' || watchedAgentIds.length > 0)}
  <div class="w-full font-family-child">
    <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground/60">
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
            <span class="text-muted-foreground/40">
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

      <!-- Inline agent avatars when collapsed -->
      {#if isCollapsed}
        <div class="flex items-center -space-x-1.5">
          {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
            <InlineAgentAvatar agentId={watchedAgentId} />
          {/each}
          {#if watchedAgentIds.length > 5}
            <span class="text-[10px] text-muted-foreground/50 pl-2">
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
              class="text-muted-foreground/40 hover:text-muted-foreground/70"
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
              class="text-muted-foreground/40 hover:text-muted-foreground/70"
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
    <div class="flex flex-col gap-0.5 w-full pl-4.5 pr-2 font-family-child" transition:slide={{ duration: 150 }}>
      {#each watchedAgentIds.slice(0, 5) as watchedAgentId (watchedAgentId)}
        <AgentCard agentId={watchedAgentId} />
      {/each}
      {#if watchedAgentIds.length > 5}
        <div class="text-[10px] text-muted-foreground/50 text-center py-1">
          +{watchedAgentIds.length - 5} more agents
        </div>
      {/if}
    </div>
  {/if}
{/if}

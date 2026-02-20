<script lang="ts">
  import { cn } from '$lib/utils';
  import AgentNavRail from './AgentNavRail.svelte';
  import TerminalNavRail from './TerminalNavRail.svelte';
  import { Fa } from 'svelte-fa';
  import { faStarOfLife } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import type { PanelVisibilityManager } from '$features/workspace/panel-visibility-manager.svelte';
  import { agentService } from '$features/agent/agent.service';
  import { sessionStore } from '$features/agent/browser';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { onMount } from 'svelte';

  interface DockItem {
    id: string;
    type: 'agent' | 'terminal';
    name: string;
  }

  let {
    agents = [],
    terminals = [],
    activeItemId = null,
    showOverview = false,
    onCreateAgent,
    onCreateTerminal,
    onSelectAgent,
    onSelectTerminal,
    onToggleOverview,
    panelVisibilityManager,
    class: className = '',
    isLoading = false,
    drawerOpen = false,
    drawerType = null,
  }: {
    agents?: any[];
    terminals?: any[];
    activeItemId?: string | null;
    showOverview?: boolean;
    onCreateAgent?: () => void;
    onCreateTerminal?: () => void;
    onSelectAgent?: (agentId: string) => void;
    onSelectTerminal?: (terminalId: string) => void;
    onToggleOverview?: () => void;
    panelVisibilityManager?: PanelVisibilityManager;
    class?: string;
    isLoading?: boolean;
    drawerOpen?: boolean;
    drawerType?: string | null;
  } = $props();

  // Reactive visibility state with fallback
  let showAgentNavRail = $derived(panelVisibilityManager?.showAgentNavRail ?? true);
  let showTerminalNavRail = false;

  // Reactive trigger for agent state changes
  // This forces re-computation of dockAgents when relevant agent state changes
  let agentStateTick = $state(0);

  // Track unread count to trigger reactivity when unread state changes
  let unreadCount = $state(0);

  // Track previous streaming/processing state to detect relevant changes
  let previousStreamingState = new Map<string, boolean>();

  // Subscribe to agent service changes to detect when background agents start/stop streaming
  // OPTIMIZATION: Only trigger updates when streaming/processing state actually changes
  onMount(() => {
    const unsubscribeAgent = sessionStore.getStore().subscribe(() => {
      // Check if any agent's streaming/processing state has changed
      const allSessions = agentService.getAllSessions();
      let hasRelevantChange = false;

      for (const session of allSessions) {
        const isRunning = session.isStreaming || session.isResponding || session.isProcessing;
        const wasRunning = previousStreamingState.get(session.id) ?? false;

        if (isRunning !== wasRunning) {
          hasRelevantChange = true;
          previousStreamingState.set(session.id, !!isRunning);
        }
      }

      // Only increment tick if there was a relevant change
      if (hasRelevantChange) {
        agentStateTick++;
      }
    });

    const unsubscribeUnread = unreadTrackingService.subscribe((count) => {
      unreadCount = count;
    });

    // Also subscribe to unified state store streaming changes for more reliable reactivity
    const unsubscribeStreaming = unifiedStateStore.onStreamingChange(() => {
      // Force update when any agent starts/stops streaming
      agentStateTick++;
    });

    return () => {
      unsubscribeAgent();
      unsubscribeUnread();
      unsubscribeStreaming();
      previousStreamingState.clear();
    };
  });

  /**
   * Check if an agent is currently streaming via unified state store
   * This is more reliable than checking session properties directly
   */
  function isAgentStreamingFromStore(agentId: string): boolean {
    const currentWorkspace = unifiedStateStore.getCurrentWorkspace();
    if (!currentWorkspace) return false;
    const agentState = currentWorkspace.agents.get(agentId as any);
    return agentState?.streaming?.active ?? false;
  }

  // Filter agents for dock display
  // Show non-background agents always, and background agents when they're running, active, or have unread messages
  let dockAgents = $derived(
    (() => {
      // Reference agentStateTick and unreadCount to make this reactive to state changes
      void agentStateTick;
      void unreadCount;

      const regularAgents = agents.filter((a) => !a.isBackground && !a.metadata?.isBackground);

      // Get all sessions to find running background agents
      const allSessions = agentService.getAllSessions();

      // Find background agents that should be shown in the dock:
      // 1. Currently running (streaming/responding)
      // 2. Have unread messages (completed but not viewed)
      const visibleBackgroundAgents = allSessions.filter((s) => {
        const isBackground = s.isBackground || s.metadata?.isBackground;
        if (!isBackground) return false;

        // Show if actively streaming or responding (check both session props and unified state store)
        const isRunning =
          s.isStreaming || s.isResponding || s.isProcessing || isAgentStreamingFromStore(s.id);
        if (isRunning) return true;

        // Show if has unread messages (completed but not read yet)
        if (unreadTrackingService.hasUnread(s.id)) return true;

        return false;
      });

      // If a background agent is currently active in the drawer, include it
      let activeBackgroundAgent = null;
      if (activeItemId && drawerOpen && drawerType === 'agent') {
        // First check in the regular agents array
        let activeAgent = agents.find((a) => a.id === activeItemId);

        // If not found, check all sessions (includes background agents)
        if (!activeAgent) {
          activeAgent = allSessions.find((s) => s.id === activeItemId);
        }

        if (activeAgent && (activeAgent.isBackground || activeAgent.metadata?.isBackground)) {
          activeBackgroundAgent = activeAgent;
        }
      }

      // Combine: regular agents + visible background agents + active background agent (if not already included)
      const result = [...regularAgents];

      // Add visible background agents
      for (const bgAgent of visibleBackgroundAgents) {
        if (!result.find((a) => a.id === bgAgent.id)) {
          result.push(bgAgent);
        }
      }

      // Add active background agent if not already in the list
      if (activeBackgroundAgent && !result.find((a) => a.id === activeBackgroundAgent.id)) {
        result.push(activeBackgroundAgent);
      }

      return result;
    })(),
  );
</script>

<!-- Overview Toggle Button -->
<div class="h-full flex flex-col items-center gap-3">
  <Button size="icon" variant="ghost-light" class="h-9 w-9 mt-5" onclick={onToggleOverview}>
    <Fa icon={faStarOfLife} size="sm" />
  </Button>
  {#if showAgentNavRail}
    <div class="w-full flex flex-col min-h-0">
      <!-- Agents Section -->
      <AgentNavRail
        agents={dockAgents}
        {activeItemId}
        onCreate={onCreateAgent}
        onSelect={onSelectAgent}
        {isLoading}
        {drawerOpen}
        {drawerType}
      />
    </div>
  {/if}

  {#if showTerminalNavRail}
    <div class="w-full flex flex-col min-h-0 pt-6 mt-auto">
      <!-- Terminals Section -->
      <TerminalNavRail
        {terminals}
        {activeItemId}
        onCreate={onCreateTerminal}
        onSelect={onSelectTerminal}
        {isLoading}
        {drawerOpen}
        {drawerType}
      />
    </div>
  {/if}
</div>

<script lang="ts">
  /**
   * AgentOverviewPanel Component
   *
   * Simplified panel that renders the agent hierarchy visualization.
   * Uses a clean hierarchical layout showing delegation relationships.
   */
  import { onMount, onDestroy, untrack } from 'svelte';
  import { createAgentOverviewStore } from './agent-overview.store.svelte';
  import type { AgentNode } from './types';
  import { isAgentNode } from './types';
  import AgentHierarchyGraph from './AgentHierarchyGraph.svelte';
  import { queryEvents, onEventCreated } from '$features/events/events.client';
  import { createLogger } from '$lib/utils/client-logger';
  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';

  const logger = createLogger('AgentOverviewPanel');

  interface Props {
    workspaceId: string;
  }

  let { workspaceId }: Props = $props();

  // Create store for graph state
  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const store = createAgentOverviewStore(workspaceId);

  // Subscribe to all agents reactively
  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const agentSubscription = useAllAgentsSubscription(workspaceId);

  // Reactively update store when agents change
  $effect(() => {
    const agents = agentSubscription.current;
    if (agents.length > 0) {
      untrack(() => {
        store.updateAgents(agents);
      });
    }
  });

  // Load initial events and set up real-time subscription
  let unsubscribe: (() => void) | null = null;

  onMount(async () => {
    // Load historical events
    try {
      const events = await queryEvents(workspaceId, [], 200);
      store.processWorkspaceEvents(events);
    } catch (error) {
      logger.error('Failed to load events', { error });
    }

    // Subscribe to real-time events
    unsubscribe = onEventCreated((data) => {
      if (data.workspaceId === workspaceId) {
        store.addRealtimeEvent(data.event);
      }
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  // Handle agent click - open agent panel using workspace:open-agent event
  // This ensures consistent behavior with other components and proper panel focus
  function handleAgentClick(agentId: string, _agentName: string, event: MouseEvent) {
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    const sourcePanelId = findSourcePanelId(event.target);

    // Dispatch workspace:open-agent event for consistent handling
    // This is handled by the workspace page and ensures proper panel focus
    window.dispatchEvent(
      new CustomEvent('workspace:open-agent', {
        detail: { agentId, sourcePanelId, openInAdjacentPanel },
      }),
    );
  }

  // Derived values from store
  const graphState = $derived(store.graphState);

  // Get only agent nodes
  const agentNodes = $derived(graphState.nodes.filter((n): n is AgentNode => isAgentNode(n)));
</script>

<div class="agent-overview-panel flex flex-col h-full bg-background overflow-auto">
  <AgentHierarchyGraph
    agents={agentNodes}
    edges={graphState.edges}
    onAgentClick={handleAgentClick}
  />
</div>

<style>
  .agent-overview-panel {
    min-height: 300px;
  }
</style>

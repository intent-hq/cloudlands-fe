<script lang="ts">
  /**
   * AgentOverviewPanel Component
   *
   * Simplified panel that renders the agent hierarchy visualization.
   * Uses a clean hierarchical layout showing delegation relationships.
   */
  import {
  onDestroy,
  untrack,
} from 'svelte';
  import type { AgentNode } from './types';
  import { isAgentNode } from './types';
  import AgentHierarchyGraph from './AgentHierarchyGraph.svelte';

  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { selectGraphState } from '$store/renderer/slices/agent-overview/agent-overview-selectors';
  import { selectWorkspaceEvents } from '$store/renderer/slices/workspace-events/workspace-events-selectors';
  import { loadEventsRequested } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import {
  processWorkspaceEvents,
  clearAgentOverview,
} from '$store/renderer/slices/agent-overview/agent-overview-slice';
  import { convertToInteractionEvent } from './graph-helpers';
  import type { InteractionEvent } from './types';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    onFocus?: () => void;
  }

  let { workspaceId, onFocus }: Props = $props();


  // Create store for graph state — agents are derived from the agent-session slice
  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const graphState$ = selectGraphState(workspaceId);

  // Request events from the saga (handles IPC query + real-time listeners)
  appStore.dispatch(loadEventsRequested(workspaceId));

  // Subscribe to workspace events from Redux and convert to interaction events
  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const workspaceEvents$ = selectWorkspaceEvents(workspaceId);
  $effect(() => {
    const events = $workspaceEvents$;
    untrack(() => {
      const interactions: InteractionEvent[] = [];
      for (const event of events) {
        const interaction = convertToInteractionEvent(event);
        if (interaction) interactions.push(interaction);
      }
      if (interactions.length > 0) {
        appStore.dispatch(processWorkspaceEvents(workspaceId, interactions));
      }
    });
  });

  onDestroy(() => {
    appStore.dispatch(clearAgentOverview(workspaceId));
  });

  // Handle agent click - open agent panel using workspace:open-agent event
  function handleAgentClick(agentId: string, _agentName: string, event: MouseEvent) {
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    const sourcePanelId = findSourcePanelId(event.target);

    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        openInAdjacentPanel,
      }),
    );
  }

  // Derived values from Redux selector

  // Get only agent nodes
  const agentNodes = $derived($graphState$.nodes.filter((n): n is AgentNode => isAgentNode(n)));
</script>

<div class="agent-overview-panel flex flex-col h-full bg-background overflow-auto">
  <AgentHierarchyGraph
    agents={agentNodes}
    edges={$graphState$.edges}
    onAgentClick={handleAgentClick}
    {onFocus}
  />
</div>

<style>
  .agent-overview-panel {
    min-height: 300px;
  }
</style>

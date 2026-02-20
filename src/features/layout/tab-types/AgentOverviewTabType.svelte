<script lang="ts">
  /**
   * Agent Overview Tab Type Component
   *
   * Renders the agent overview visualization.
   */

  import type { TabTypeComponentProps } from './registry';
  import { AgentOverviewPanel } from '$lib/components/agent-overview';

  let { workspaceId }: TabTypeComponentProps = $props();
</script>

<AgentOverviewPanel {workspaceId} />

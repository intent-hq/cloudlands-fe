<script lang="ts">
  /**
   * Agent Overview Tab Type Component
   *
   * Renders the workspace's recent agent activity as a trace waterfall.
   */

  import type { TabTypeComponentProps } from './registry';
  import AgentTracePanel from '$features/agent-trace/components/AgentTracePanel.svelte';

  let { workspaceId, isActive, onFocus }: TabTypeComponentProps = $props();
</script>

<AgentTracePanel {workspaceId} active={isActive} {onFocus} />

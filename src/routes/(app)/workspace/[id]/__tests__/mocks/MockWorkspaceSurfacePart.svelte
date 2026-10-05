<script lang="ts">
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  let {
    marker,
    active,
    workspaceId,
    layoutId,
    panelLayoutId,
    onCreateAgent,
    onCreateAgentWithSpecialist,
  }: {
    marker?: string;
    active?: boolean;
    workspaceId?: string;
    layoutId?: string;
    panelLayoutId?: string;
    onCreateAgent?: unknown;
    onCreateAgentWithSpecialist?: unknown;
  } = $props();

  // Captured once at mount, like every consumer of the frozen route context.
  const routeContext = getWorkspaceRouteContext();
</script>

<div
  data-workspace-surface-part={marker}
  data-active={active}
  data-workspace-id={workspaceId}
  data-layout-id={layoutId ?? panelLayoutId}
  data-route-workspace-id={routeContext ? String(routeContext.workspaceId) : undefined}
>
  {#if typeof onCreateAgent === 'function'}
    <span data-create-agent-affordance="agent"></span>
  {/if}
  {#if typeof onCreateAgentWithSpecialist === 'function'}
    <span data-create-agent-affordance="specialist"></span>
  {/if}
</div>

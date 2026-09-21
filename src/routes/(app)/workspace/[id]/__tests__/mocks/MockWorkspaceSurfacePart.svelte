<script lang="ts">
  let {
    marker,
    active,
    onCreateAgent,
    onCreateAgentWithSpecialist,
  }: {
    marker?: string;
    active?: boolean;
    onCreateAgent?: unknown;
    onCreateAgentWithSpecialist?: unknown;
  } = $props();
</script>

<div data-workspace-surface-part={marker} data-active={active}>
  {#if typeof onCreateAgent === 'function'}
    <span data-create-agent-affordance="agent"></span>
  {/if}
  {#if typeof onCreateAgentWithSpecialist === 'function'}
    <span data-create-agent-affordance="specialist"></span>
  {/if}
</div>

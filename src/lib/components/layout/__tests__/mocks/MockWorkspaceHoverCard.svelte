<script lang="ts">
  let { workspace = null, activeAgentIds = [] }: any = $props();
</script>

<div data-workspace-hover-card>
  <div data-workspace-hover-card-title>{workspace?.title}</div>
  <div data-workspace-hover-card-status>{workspace?.statusMessage}</div>
  <div data-workspace-hover-card-progress></div>
  <div data-workspace-hover-card-agents>{activeAgentIds.join(',')}</div>
</div>

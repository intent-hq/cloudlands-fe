<script lang="ts">
  let { hideActionsMenu = false }: { hideActionsMenu?: boolean } = $props();
</script>

<div data-testid="workspace-progress-card">
  {#if !hideActionsMenu}
    <div data-workspace-actions-kebab></div>
  {/if}
</div>

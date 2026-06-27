<script lang="ts">
  // Minimal stand-in for FileChangesList that exposes per-file action buttons,
  // forwarding the full TrackedChange object to the handlers (matching the real
  // component's callback contract) so tests can assert routing behaviour.
  let {
    changes = [],
    onFileClick,
    onStageClick,
    onUnstageClick,
    onRevertClick,
  }: any = $props();
</script>

{#each changes as change (change.id)}
  <div data-testid="file-row" data-file-path={change.relativePath}>
    {#if onStageClick}
      <button data-testid="stage-btn" onclick={() => onStageClick(change)}>Stage</button>
    {/if}
    {#if onUnstageClick}
      <button data-testid="unstage-btn" onclick={() => onUnstageClick(change)}>Unstage</button>
    {/if}
    {#if onRevertClick}
      <button data-testid="revert-btn" onclick={() => onRevertClick(change)}>Revert</button>
    {/if}
    {#if onFileClick}
      <button data-testid="file-click" onclick={() => onFileClick(change)}>Open</button>
    {/if}
  </div>
{/each}

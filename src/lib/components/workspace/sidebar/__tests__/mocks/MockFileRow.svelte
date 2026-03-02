<script lang="ts">
  let { file, onFileClick, onStage, onUnstage, onRevert, onOpenFile, onSelectClick, showStageAction, showRevertAction, active, selected, focused, locked }: any = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="file-row"
  data-file-path={file?.path}
  data-active={active}
  data-selected={selected}
  data-focused={focused}
  data-locked={locked}
  onclick={(e: MouseEvent) => {
    if (e.shiftKey && onSelectClick) {
      onSelectClick(file?.path, e);
    }
  }}
>
  <span class="file-name">{file?.path?.split('/').pop() ?? ''}</span>
  {#if showStageAction && onStage}
    <button data-testid="stage-btn" onclick={() => onStage?.(file?.path)}>Stage</button>
  {/if}
  {#if showStageAction && onUnstage}
    <button data-testid="unstage-btn" onclick={() => onUnstage?.(file?.path)}>Unstage</button>
  {/if}
  {#if showRevertAction && onRevert}
    <button data-testid="revert-btn" onclick={() => onRevert?.(file?.path)}>Revert</button>
  {/if}
  <button data-testid="file-click" onclick={() => onFileClick?.(file?.path)}>Open</button>
</div>


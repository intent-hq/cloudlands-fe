<script lang="ts">
  let {
    change,
    onStageHunk,
    onUnstageHunk,
  }: {
    change?: { file?: string };
    onStageHunk?: (filePath: string, patch: string) => void;
    onUnstageHunk?: (filePath: string, patch: string) => void;
  } = $props();
</script>

<div data-testid="tracked-change-diff-viewer" data-file={change?.file ?? ''}></div>
{#if onStageHunk}
  <button
    data-testid="stage-hunk"
    aria-label="stage hunk"
    onclick={() => onStageHunk(change?.file ?? '', '@@ patch')}
  ></button>
{/if}
{#if onUnstageHunk}
  <button
    data-testid="unstage-hunk"
    aria-label="unstage hunk"
    onclick={() => onUnstageHunk(change?.file ?? '', '@@ patch')}
  ></button>
{/if}

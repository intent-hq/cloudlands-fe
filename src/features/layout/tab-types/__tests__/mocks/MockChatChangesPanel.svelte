<script lang="ts">
  let {
    changes = [],
    onStage,
    onUnstage,
    onRevert,
    gitRootId,
    gitRootPath,
    showStagingControls = false,
  }: {
    changes?: Array<{
      filePath: string;
      toolCallId: string;
      additions?: number;
      deletions?: number;
    }>;
    onStage?: (path: string) => void;
    onUnstage?: (path: string) => void;
    onRevert?: (path: string) => void;
    gitRootId?: string;
    gitRootPath?: string;
    showStagingControls?: boolean;
  } = $props();
</script>

<div
  data-testid="chat-changes-panel"
  data-git-root-id={gitRootId}
  data-git-root-path={gitRootPath}
  data-show-staging-controls={showStagingControls}
>
  {#each changes as change (change.toolCallId)}
    <div
      data-testid="chat-change"
      data-file-path={change.filePath}
      data-additions={change.additions}
      data-deletions={change.deletions}
    >
      <!-- i18n-ignore (test mock) -->
      <button
        data-testid="stage-button"
        aria-label="stage"
        onclick={() => onStage?.(change.filePath)}
      ></button>
      <!-- i18n-ignore (test mock) -->
      <button
        data-testid="unstage-button"
        aria-label="unstage"
        onclick={() => onUnstage?.(change.filePath)}
      ></button>
      <!-- i18n-ignore (test mock) -->
      <button
        data-testid="revert-button"
        aria-label="revert"
        onclick={() => onRevert?.(change.filePath)}
      ></button>
    </div>
  {/each}
</div>

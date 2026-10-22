<script lang="ts">
  let {
    workspaceId,
    filePath,
    gitRootId,
  }: { workspaceId: string; filePath: string; gitRootId?: string } = $props();
</script>

<div
  data-testid="pdf-viewer"
  data-workspace-id={workspaceId}
  data-file-path={filePath}
  data-git-root-id={gitRootId}
></div>

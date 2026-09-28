<script lang="ts">
  let { workspaceId, filePath }: { workspaceId: string; filePath: string } = $props();
</script>

<div data-testid="pdf-viewer" data-workspace-id={workspaceId} data-file-path={filePath}></div>

<script lang="ts">
  let { content, workspaceId }: { content: string; workspaceId?: string } = $props();
</script>

<div data-testid="markdown-viewer" data-workspace-id={workspaceId}>{content}</div>

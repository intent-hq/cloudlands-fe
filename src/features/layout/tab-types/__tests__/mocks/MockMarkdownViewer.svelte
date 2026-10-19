<script lang="ts">
  let {
    content,
    workspaceId,
    relativeMediaBase,
  }: { content: string; workspaceId?: string; relativeMediaBase?: string } = $props();
</script>

<div
  data-testid="markdown-viewer"
  data-workspace-id={workspaceId}
  data-relative-media-base={relativeMediaBase ?? '(unset)'}
>
  {content}
</div>

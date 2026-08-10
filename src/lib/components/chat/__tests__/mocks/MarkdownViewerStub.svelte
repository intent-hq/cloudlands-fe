<script lang="ts">
  // Stands in for MarkdownViewer, whose TipTap editor graph needs a real DOM.
  export let content: string = '';
</script>

<div data-testid="markdown-viewer">{content}</div>

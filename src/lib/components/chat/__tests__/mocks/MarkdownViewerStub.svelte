<script lang="ts">
  // Stands in for MarkdownViewer, whose TipTap editor graph needs a real DOM.
  export let content: string = '';
  export let isStreaming: boolean = false;
</script>

<div data-testid="markdown-viewer" data-streaming={isStreaming}>{content}</div>

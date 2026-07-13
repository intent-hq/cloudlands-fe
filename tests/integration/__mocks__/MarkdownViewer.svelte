<script lang="ts">
  export let content: string = '';
  export let isStreaming: boolean = false;
  export let onFileClick: ((path: string) => void) | undefined = undefined;
</script>

<div class="markdown-viewer" class:streaming={isStreaming}>
  {content}
</div>

<style>
  .markdown-viewer {
    padding: 0.5rem;
  }
  .streaming {
    opacity: 0.8;
  }
</style>

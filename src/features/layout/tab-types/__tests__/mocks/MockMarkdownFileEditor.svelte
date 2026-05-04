<script lang="ts">
  let { value = $bindable('') } = $props();
</script>

<textarea data-testid="markdown-file-editor" aria-label="Mock markdown editor" bind:value
></textarea>

<script lang="ts">
  let { value = $bindable(''), externalContentVersion = 0 } = $props();
</script>

<textarea
  data-testid="markdown-file-editor"
  aria-label="Mock markdown editor"
  data-external-content-version={externalContentVersion}
  bind:value
></textarea>

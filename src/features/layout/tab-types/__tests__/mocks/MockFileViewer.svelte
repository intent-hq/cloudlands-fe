<script lang="ts">
  let { fileContent = '', filePath = '' } = $props();
</script>

<div data-testid="file-viewer" data-file-path={filePath}>{fileContent}</div>

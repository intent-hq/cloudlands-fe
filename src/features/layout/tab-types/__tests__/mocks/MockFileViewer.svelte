<script lang="ts">
  let { fileContent = '', filePath = '', language = '', isBinary = false } = $props();
</script>

<div
  data-testid="file-viewer"
  data-file-path={filePath}
  data-language={language}
  data-is-binary={isBinary}
>
  {fileContent}
</div>

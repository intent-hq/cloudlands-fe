<script lang="ts">
  let {
    fileContent = '',
    filePath = '',
    sourceUrl = '',
    language = '',
    isBinary = false,
  } = $props();
</script>

<div
  data-testid="file-viewer"
  data-file-path={filePath}
  data-source-url={sourceUrl}
  data-language={language}
  data-is-binary={isBinary}
>
  {fileContent}
</div>

<script lang="ts">
  let {
    fileContent = '',
    filePath = '',
    sourceUrl = '',
    language = '',
    isBinary = false,
    onDownload,
    allowDownload = true,
    downloading = false,
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
  {#if onDownload && allowDownload}
    <button onclick={onDownload} disabled={downloading}>Download original video</button>
  {/if}
</div>

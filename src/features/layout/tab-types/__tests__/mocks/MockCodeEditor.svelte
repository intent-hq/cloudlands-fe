<script lang="ts">
  let {
    value = $bindable(''),
    language = 'plaintext',
    fileName = '',
    filePath = '',
    lineWrapping = false,
    isPanelFocused = false,
    externalContentVersion = 0,
    lineChanges = [],
    jumpTo,
  } = $props();

  const initialValue = value;
</script>

<textarea
  data-testid="code-editor"
  aria-label="Mock code editor"
  data-language={language}
  data-file-name={fileName}
  data-file-path={filePath}
  data-line-wrapping={lineWrapping}
  data-panel-focused={isPanelFocused}
  data-external-content-version={externalContentVersion}
  data-line-change-count={lineChanges.length}
  data-jump-to-line={jumpTo?.line}
  data-initial-value={initialValue}
  bind:value></textarea>

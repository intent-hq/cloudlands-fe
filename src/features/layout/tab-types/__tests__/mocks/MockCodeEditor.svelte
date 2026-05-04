<script lang="ts">
  let {
    value = $bindable(''),
    language = 'plaintext',
    fileName = '',
    lineWrapping = false,
    isPanelFocused = false,
  } = $props();
</script>

<textarea
  data-testid="code-editor"
  aria-label="Mock code editor"
  data-language={language}
  data-file-name={fileName}
  data-line-wrapping={lineWrapping}
  data-panel-focused={isPanelFocused}
  bind:value
></textarea>

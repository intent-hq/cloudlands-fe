<script lang="ts">
  // Minimal mock for CodeEditor to avoid monaco-editor imports in tests
  interface Props {
    value?: string;
    language?: string;
    lineNumbers?: boolean;
    readOnly?: boolean;
    placeholder?: string;
  }

  let { value, language, lineNumbers: _lineNumbers, readOnly: _readOnly, placeholder }: Props = $props();
</script>

<div class="mock-code-editor" data-language={language}>
  {#if value}
    <pre>{value}</pre>
  {:else if placeholder}
    <div class="placeholder">{placeholder}</div>
  {/if}
</div>

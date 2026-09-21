<script lang="ts">
  import '$lib/styles/tiptap-editor.css';
  import OneRowTaskSurfaceHarness from './OneRowTaskSurfaceHarness.svelte';
  let { theme = 'light' }: { theme?: 'light' | 'dark' } = $props();
</script>

<div class:dark={theme === 'dark'} class="note-font-serif bg-background p-4 text-foreground">
  <div class="tiptap-editor">
    <p data-note-body>Tasks use the same typography as this note.</p>
    <OneRowTaskSurfaceHarness {theme} width={600} />
  </div>
</div>

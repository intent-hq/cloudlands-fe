<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    sidebar,
    content,
    terminalOverlay,
    modals,
  }: {
    sidebar: Snippet;
    content: Snippet;
    terminalOverlay?: Snippet;
    modals?: Snippet;
  } = $props();
</script>

<div data-workspace-layout>
  <aside data-workspace-sidebar>{@render sidebar()}</aside>
  <main data-panel-canvas>{@render content()}</main>
  <div data-resize-handle></div>
  <footer data-terminal-dock>{@render terminalOverlay?.()}</footer>
</div>
{@render modals?.()}

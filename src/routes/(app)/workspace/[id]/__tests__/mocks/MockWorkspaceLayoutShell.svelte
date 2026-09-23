<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    sidebar,
    content,
    terminalOverlay,
    modals,
    sidebarSide,
  }: {
    sidebar: Snippet;
    content: Snippet;
    terminalOverlay?: Snippet;
    modals?: Snippet;
    sidebarSide?: 'left' | 'right';
  } = $props();
</script>

<div data-workspace-layout data-sidebar-side={sidebarSide}>
  <aside data-workspace-sidebar>{@render sidebar()}</aside>
  <main data-panel-canvas>{@render content()}</main>
  <div data-resize-handle></div>
  <footer data-terminal-dock>{@render terminalOverlay?.()}</footer>
</div>
{@render modals?.()}

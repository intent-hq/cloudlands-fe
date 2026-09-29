<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { slide } from '$lib/motion';

  let { children }: { children: Snippet } = $props();
</script>

<div
  class="home-preview-pane min-h-0 min-w-0 shrink-0"
  transition:slide|global={{ axis: 'x', tier: 'fast' }}
>
  <ResizablePanel
    storageKey="home-preview-width"
    side="right"
    minWidth={320}
    maxWidth={800}
    defaultWidth={460}
    className="home-preview-resizable h-full max-w-full border-l border-border"
  >
    {@render children()}
  </ResizablePanel>
</div>

<style>
  .home-preview-pane {
    max-width: 60%;
    height: 100%;
  }
  .home-preview-pane :global(.home-preview-resizable) {
    min-width: 0 !important;
    max-width: 100% !important;
  }
  @container (max-width: 1000px) {
    .home-preview-pane {
      width: 100%;
      max-width: 100%;
    }
    .home-preview-pane :global(.home-preview-resizable) {
      width: 100% !important;
      border-left: 0;
    }
    .home-preview-pane :global(.resizable-panel-handle) {
      display: none;
    }
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { slide } from '$lib/motion';
  import { observeHomePanelWidth } from './home-panel-width';

  let { children }: { children: Snippet } = $props();
  let maxWidth = $state(Number.MAX_SAFE_INTEGER);
</script>

<div
  class="home-preview-pane min-h-0 min-w-0 shrink-0 bg-sidebar pl-3"
  use:observeHomePanelWidth={(width) => (maxWidth = width)}
  transition:slide|global={{ axis: 'x', tier: 'fast' }}
>
  <ResizablePanel
    storageKey="home-preview-width"
    side="right"
    minWidth={320}
    {maxWidth}
    defaultWidth={460}
    handleClassName="home-preview-resize-handle"
    className="home-preview-resizable h-full max-w-full home-panel bg-background"
  >
    <div class="h-full min-h-0 overflow-hidden rounded-[inherit]">
      {@render children()}
    </div>
  </ResizablePanel>
</div>

<style>
  .home-preview-pane {
    max-width: 100%;
    height: 100%;
  }
  .home-preview-pane :global(.home-preview-resizable) {
    min-width: 0 !important;
    max-width: 100% !important;
  }
  .home-preview-pane :global(.home-preview-resize-handle) {
    left: -0.75rem;
    width: 0.75rem;
    clip-path: none;
  }
  .home-preview-pane :global(.home-preview-resize-handle)::before {
    left: 50%;
    opacity: 0;
  }
  @container home-layout (max-width: 1000px) {
    .home-preview-pane {
      width: 100%;
      max-width: 100%;
      padding-left: 0;
    }
    .home-preview-pane :global(.home-preview-resizable) {
      width: 100% !important;
    }
    .home-preview-pane :global(.resizable-panel-handle) {
      display: none;
    }
  }
  @container home-integrations (max-width: 1000px) {
    .home-preview-pane {
      width: 100%;
      max-width: 100%;
      padding-left: 0;
    }
    .home-preview-pane :global(.home-preview-resizable) {
      width: 100% !important;
    }
    .home-preview-pane :global(.resizable-panel-handle) {
      display: none;
    }
  }
</style>

<script lang="ts">
  import ResizablePanel from '../../ResizablePanel.svelte';

  let { variant = 'sidebar-left' }: { variant?: 'sidebar-left' | 'sidebar-right' | 'stack-top' } =
    $props();
</script>

{#if variant === 'stack-top'}
  <!-- Vertical stack: panel with a top-edge handle below a horizontally
       scrolling neighbor whose scrollbar hugs the shared boundary. -->
  <div class="flex h-[400px] w-[600px] flex-col">
    <div class="min-h-0 flex-1 overflow-x-auto" data-testid="neighbor-scroll">
      <div style="width: 2000px; height: 10px;"></div>
    </div>
    <ResizablePanel
      orientation="vertical"
      edge="top"
      defaultHeight={160}
      minHeight={100}
      maxHeight={300}
      storageKey={null}
    >
      <div class="h-full" data-testid="panel-content"></div>
    </ResizablePanel>
  </div>
{:else}
  <!-- Horizontal row: the resizable panel scrolls vertically, so its own
       scrollbar hugs its right edge; a right-side panel instead neighbors a
       scrolling pane whose scrollbar hugs the shared boundary. -->
  <div class="flex h-[400px] w-[800px]">
    {#if variant === 'sidebar-right'}
      <div class="min-w-0 flex-1 overflow-y-auto" data-testid="neighbor-scroll">
        <div style="height: 2000px;"></div>
      </div>
    {/if}
    <ResizablePanel
      side={variant === 'sidebar-right' ? 'right' : 'left'}
      defaultWidth={300}
      minWidth={200}
      maxWidth={500}
      storageKey={null}
      className="h-full"
    >
      <div class="h-full overflow-y-auto" data-testid="panel-scroll">
        <div style="height: 2000px;"></div>
      </div>
    </ResizablePanel>
    {#if variant === 'sidebar-left'}
      <div class="min-w-0 flex-1" data-testid="neighbor"></div>
    {/if}
  </div>
{/if}

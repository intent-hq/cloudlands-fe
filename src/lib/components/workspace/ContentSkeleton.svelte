<script lang="ts">
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import type { PanelLayoutNode } from '$store/renderer/slices/panel-layout/panel-layout-types';

  let { panelCount = 1, layoutRoot }: { panelCount?: number; layoutRoot?: PanelLayoutNode } =
    $props();
  const visiblePanelCount = $derived(
    Number.isFinite(panelCount) ? Math.max(1, Math.floor(panelCount)) : 1,
  );
  const fallbackLayoutRoot = $derived.by((): PanelLayoutNode => {
    if (visiblePanelCount === 1) return { type: 'panel', panelId: 'loading-panel-0' };
    return {
      type: 'split',
      direction: 'horizontal',
      children: Array.from({ length: visiblePanelCount }, (_, index) => ({
        type: 'panel' as const,
        panelId: `loading-panel-${index}`,
      })),
      sizes: Array.from({ length: visiblePanelCount }, () => 100 / visiblePanelCount),
    };
  });
  const skeletonLayoutRoot = $derived(layoutRoot ?? fallbackLayoutRoot);

  function getChildStyle(node: PanelLayoutNode, index: number): string {
    if (node.type !== 'split') return '';
    const size = node.sizes[index] ?? 100 / Math.max(1, node.children.length);
    return `flex: ${size} 1 0%;`;
  }
</script>

{#snippet loadingPanel()}
  <div
    class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    data-loading-panel
  >
    <div
      class="flex h-[var(--panel-header-height)] flex-none items-center gap-3 border-b border-border px-5"
    >
      <Skeleton class="size-3.5 shrink-0 rounded-full" />
      <Skeleton class="h-3 w-24 max-w-2/5" />
      <Skeleton class="ml-auto h-3 w-10" />
    </div>

    <div class="flex-1 space-y-6 p-6">
      <div class="space-y-3">
        <Skeleton class="h-4 w-2/5" />
        <Skeleton class="h-3 w-full" />
        <Skeleton class="h-3 w-5/6" />
      </div>
      <div class="space-y-3">
        <Skeleton class="h-3 w-3/4" />
        <Skeleton class="h-3 w-1/2" />
      </div>
    </div>
  </div>
{/snippet}

{#snippet loadingNode(node: PanelLayoutNode)}
  {#if node.type === 'panel'}
    {@render loadingPanel()}
  {:else}
    <div
      class="flex h-full min-h-0 w-full min-w-0 gap-2 {node.direction === 'vertical'
        ? 'flex-col'
        : ''}"
      data-loading-split={node.direction}
    >
      {#each node.children as child, index}
        <div class="min-h-0 min-w-0" style={getChildStyle(node, index)}>
          {@render loadingNode(child)}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div
  class="h-full w-full bg-sidebar p-2"
  data-workspace-content-skeleton
  data-panel-count={visiblePanelCount}
>
  {@render loadingNode(skeletonLayoutRoot)}
</div>

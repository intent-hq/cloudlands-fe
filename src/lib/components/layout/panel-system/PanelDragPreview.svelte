<script lang="ts">
  import type { PanelLayoutNode } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import PanelDragPreview from './PanelDragPreview.svelte';
  import { renderPanelLayoutPreview } from './panel-stack-preview';
  import { getPanelReferenceSize } from './panel-resize';

  let {
    node,
    draggedPanelId,
    contained = false,
    isRoot = true,
  }: {
    node: PanelLayoutNode;
    draggedPanelId: string;
    contained?: boolean;
    isRoot?: boolean;
  } = $props();
  let splitElement = $state<HTMLDivElement | null>(null);
  let panelReferenceSize = $state<number | null>(null);

  function getNodeKey(child: PanelLayoutNode): string {
    if (child.type === 'panel') return child.panelId;
    return `${child.direction}:${child.children.map(getNodeKey).join(',')}`;
  }

  function getChildStyle(index: number): string {
    if (node.type !== 'split') return '';
    const size = node.sizes[index] ?? 100 / node.children.length;
    if (contained || panelReferenceSize === null) return `flex: ${size} 1 0%`;
    return `flex: 0 0 ${(panelReferenceSize * size) / 100}px`;
  }

  $effect(() => {
    if (node.type !== 'split' || !splitElement) return;
    const element = splitElement;
    const measure = () => {
      const children = [...element.children] as HTMLElement[];
      const firstChild = children[0];
      const minimumPanelSize = firstChild
        ? Number.parseFloat(
            node.direction === 'horizontal'
              ? getComputedStyle(firstChild).minWidth
              : getComputedStyle(firstChild).minHeight,
          ) || 0
        : 0;
      const resizeTarget = isRoot
        ? element.closest<HTMLElement>('[data-testid="panel-workspace-inset"]')
        : element.parentElement;
      const availableSize =
        node.direction === 'horizontal'
          ? (resizeTarget?.clientWidth ?? element.clientWidth)
          : (resizeTarget?.clientHeight ?? element.clientHeight);
      const gap = Number.parseFloat(getComputedStyle(element).gap) || 0;
      panelReferenceSize = getPanelReferenceSize(
        availableSize,
        children.length,
        minimumPanelSize,
        gap * Math.max(0, children.length - 1),
      );
    };

    measure();
    const resizeTarget = isRoot
      ? element.closest<HTMLElement>('[data-testid="panel-workspace-inset"]')
      : element.parentElement;
    if (!resizeTarget) return;
    const observer = new ResizeObserver(measure);
    observer.observe(resizeTarget);
    return () => observer.disconnect();
  });
</script>

{#if node.type === 'panel'}
  <div
    class={cn('relative h-full min-h-0 w-full min-w-0', node.panelId === draggedPanelId && 'z-10')}
    data-panel-layout-preview-panel={node.panelId}
    data-panel-layout-preview-dragged={node.panelId === draggedPanelId ? '' : undefined}
  >
    <div
      class="h-full min-h-0 w-full min-w-0 overflow-hidden"
      use:renderPanelLayoutPreview={node.panelId}
    ></div>
    {#if node.panelId === draggedPanelId}
      <div
        class="pointer-events-none absolute inset-1 z-20 rounded-md border-2 border-foreground/70 bg-foreground/5 shadow-(--elevation-raised)"
        data-panel-layout-preview-drag-emphasis
      ></div>
    {/if}
  </div>
{:else}
  <div
    bind:this={splitElement}
    class={cn(
      'panel-drag-preview-split flex h-full min-h-0 w-full min-w-0 gap-2',
      node.direction,
      node.direction === 'vertical' && 'flex-col',
      contained && 'contained',
    )}
    data-panel-layout-preview-split={node.direction}
  >
    {#each node.children as child, index (getNodeKey(child))}
      <div
        class="panel-drag-preview-child min-h-0 min-w-0 overflow-hidden"
        style={getChildStyle(index)}
      >
        <PanelDragPreview node={child} {draggedPanelId} {contained} isRoot={false} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .panel-drag-preview-split {
    min-width: max-content;
  }

  .panel-drag-preview-split.horizontal > .panel-drag-preview-child {
    min-width: 30em;
  }

  .panel-drag-preview-split.contained,
  .panel-drag-preview-split.contained.horizontal > .panel-drag-preview-child {
    min-width: 0;
  }
</style>

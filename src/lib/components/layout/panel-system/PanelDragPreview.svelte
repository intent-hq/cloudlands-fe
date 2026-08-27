<script lang="ts">
  import type { PanelLayoutNode, PanelState } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import PanelDragPreview from './PanelDragPreview.svelte';
  import { renderPanelLayoutPreview } from './panel-stack-preview';
  import {
    getElementContentBoxSize,
    getPanelFlexValue,
    getPanelReferenceSize,
  } from './panel-resize';
  import { PANEL_SPLIT_GUTTER_WIDTH } from '$shared/panel-layout-sizing';

  let {
    node,
    panels,
    draggedPanelId,
    draggedPanelSourceId = null,
    contained = false,
    isRoot = true,
  }: {
    node: PanelLayoutNode;
    panels: Record<string, PanelState>;
    draggedPanelId: string;
    draggedPanelSourceId?: string | null;
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
    return `flex: ${getPanelFlexValue(size, panelReferenceSize)}`;
  }

  $effect(() => {
    if (node.type !== 'split' || !splitElement) return;
    const element = splitElement;
    const resizeTarget = isRoot
      ? element.closest<HTMLElement>('[data-testid="panel-workspace-inset"]')
      : element.parentElement;
    // Preview geometry changes only with its frame-coalesced projection. Measure once
    // for that projection instead of feeding a drag-only ResizeObserver loop.
    const availableSize =
      node.direction === 'horizontal'
        ? resizeTarget
          ? getElementContentBoxSize(resizeTarget, 'horizontal')
          : element.clientWidth
        : resizeTarget
          ? getElementContentBoxSize(resizeTarget, 'vertical')
          : element.clientHeight;
    panelReferenceSize = getPanelReferenceSize(
      availableSize,
      PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, node.children.length - 1),
    );
  });
</script>

{#if node.type === 'panel'}
  {@const panel = panels[node.panelId]}
  {#if panel}
    <div
      class={cn(
        'relative h-full min-h-0 w-full min-w-0',
        node.panelId === draggedPanelId && 'z-10',
      )}
      data-panel-layout-preview-panel={node.panelId}
      data-panel-layout-preview-dragged={node.panelId === draggedPanelId ? '' : undefined}
      data-panel-layout-preview-active-pane={panel.activeTabId}
      data-panel-layout-preview-stack-size={panel.tabs.length}
    >
      <div
        class="h-full min-h-0 w-full min-w-0 overflow-hidden"
        use:renderPanelLayoutPreview={{
          panel,
          sourcePanelId: node.panelId === draggedPanelId ? draggedPanelSourceId : node.panelId,
        }}
      ></div>
      {#if node.panelId === draggedPanelId}
        <div class="panel-drop-destination" data-panel-drop-destination></div>
      {/if}
    </div>
  {/if}
{:else}
  <div
    bind:this={splitElement}
    class={cn(
      'panel-drag-preview-split flex h-full min-h-0 w-full min-w-0',
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
        <PanelDragPreview
          node={child}
          {panels}
          {draggedPanelId}
          {draggedPanelSourceId}
          {contained}
          isRoot={false}
        />
      </div>
      <!-- i18n-ignore -->
      {#if index < node.children.length - 1}
        <div
          class="panel-drag-preview-gutter shrink-0"
          style={node.direction === 'horizontal'
            ? `width: ${PANEL_SPLIT_GUTTER_WIDTH}px`
            : `height: ${PANEL_SPLIT_GUTTER_WIDTH}px`}
          data-panel-layout-preview-gutter={node.direction}
          aria-hidden="true"
        ></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .panel-drag-preview-split {
    min-width: 0;
  }

  .panel-drag-preview-split.contained,
  .panel-drag-preview-split.contained.horizontal > .panel-drag-preview-child {
    min-width: 0;
  }

  .panel-drop-destination {
    position: absolute;
    inset: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    background: hsl(var(--card) / 0.42);
    pointer-events: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .panel-drop-destination {
      animation: panel-drop-destination-in 140ms ease-out;
      transition: opacity 140ms ease-out;
    }
  }

  @keyframes panel-drop-destination-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (forced-colors: active) {
    .panel-drop-destination {
      border-color: CanvasText;
      background: Canvas;
      outline: 2px solid CanvasText;
      outline-offset: -3px;
    }
  }
</style>

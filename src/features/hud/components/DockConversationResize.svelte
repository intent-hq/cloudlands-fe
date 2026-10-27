<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    getDockConversationResize,
    type DockConversationSize,
    type DockResizeEdge,
  } from './dock-conversation-resize-context';

  let {
    active,
    workspaceId,
    surface,
  }: {
    active: boolean;
    workspaceId: string;
    surface?: HTMLElement;
  } = $props();
  const owner = getDockConversationResize();
  let held = $state<DockResizeEdge | null>(null);
  let gesture: {
    pointerId: number;
    element: HTMLElement;
    edge: DockResizeEdge;
    x: number;
    y: number;
    edgeX: number;
    edgeY: number;
  } | null = null;
  let next: DockConversationSize | null = null;
  let frame: number | undefined;
  const enabled = $derived(active && !!owner?.enabled);

  function bounded(size: DockConversationSize): DockConversationSize {
    if (!owner) return size;
    return {
      width: Math.round(Math.max(owner.minimum.width, Math.min(owner.maximum.width, size.width))),
      height: Math.round(
        Math.max(owner.minimum.height, Math.min(owner.maximum.height, size.height)),
      ),
    };
  }
  function flush(): void {
    frame = undefined;
    if (next) owner?.resize(next);
    next = null;
  }
  function finish(cancel = false): void {
    const previous = gesture;
    gesture = null;
    held = null;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (!previous) return;
    if (cancel) {
      next = null;
    } else flush();
    if (previous.element.hasPointerCapture(previous.pointerId))
      previous.element.releasePointerCapture(previous.pointerId);
    owner?.end(cancel);
  }
  function start(event: PointerEvent, edge: DockResizeEdge): void {
    if (!enabled || !owner || !surface || event.button !== 0 || !event.isPrimary || gesture) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const rect = owner.screenRect;
    element.setPointerCapture(event.pointerId);
    if (!owner.begin({ x: event.screenX, y: event.screenY })) {
      element.releasePointerCapture(event.pointerId);
      return;
    }
    gesture = {
      pointerId: event.pointerId,
      element,
      edge,
      x: event.screenX,
      y: event.screenY,
      edgeX: edge.includes('w') ? rect.x : rect.x + rect.width,
      edgeY: edge.includes('n') ? rect.y : rect.y + rect.height,
    };
    held = edge;
  }
  function move(event: PointerEvent): void {
    if (!gesture || !owner || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    next = bounded(
      owner.sizeAtPointer(gesture.edge, {
        x: gesture.edgeX + event.screenX - gesture.x,
        y: gesture.edgeY + event.screenY - gesture.y,
      }),
    );
    frame ??= requestAnimationFrame(flush);
  }
  function keyboard(event: KeyboardEvent, edge: DockResizeEdge): void {
    if (
      !enabled ||
      !owner ||
      !surface ||
      gesture ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    if (horizontal ? !/[ew]/.test(edge) : !/[ns]/.test(edge)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = owner.screenRect;
    const step =
      (event.shiftKey ? 40 : 10) * (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
    owner.resize(
      bounded({
        width: rect.width + (horizontal ? step * (edge.includes('w') ? -1 : 1) : 0),
        height: rect.height + (!horizontal ? step * (edge.includes('n') ? -1 : 1) : 0),
      }),
    );
  }
  $effect(() => {
    workspaceId;
    if (!enabled) untrack(() => finish(true));
    return () => untrack(() => finish(true));
  });
  $effect(() => {
    if (owner && !owner.held) untrack(() => finish(true));
  });
  onDestroy(() => finish(true));
</script>

<svelte:window
  onblur={() => finish(true)}
  onkeydowncapture={(event) => {
    if (!gesture || event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(true);
  }}
/>

{#if enabled && owner}
  {#each owner.edges as edge (edge)}
    <Button
      variant="ghost"
      wrapContent={false}
      class="app-resize-handle conversation-resize rounded-none"
      data-dock-resize={edge}
      data-resize-axis={edge.length === 2 ? 'both' : /[ew]/.test(edge) ? 'x' : 'y'}
      data-resizing={held === edge}
      aria-label={edge.length === 2
        ? m.layout_panelCornerHandle_resize_ariaLabel()
        : m.layout_panelSplitHandle_resize_ariaLabel()}
      tabindex={edge === owner.edges.at(-1) ? 0 : -1}
      onpointerdown={(event) => start(event, edge)}
      onpointermove={move}
      onpointerup={(event) => {
        if (gesture?.pointerId === event.pointerId) finish();
      }}
      onpointercancel={() => finish(true)}
      onlostpointercapture={() => finish(true)}
      onkeydown={(event) => keyboard(event, edge)}
    />
  {/each}
{/if}

<style>
  :global(.conversation-resize) {
    position: absolute;
    z-index: 2;
    min-width: 0;
    min-height: 0;
    padding: 0;
    touch-action: none;
  }
  :global(.conversation-resize[data-dock-resize='n']),
  :global(.conversation-resize[data-dock-resize='s']) {
    left: 14px;
    right: 14px;
    height: 5px;
    width: auto;
  }
  :global(.conversation-resize[data-dock-resize='e']),
  :global(.conversation-resize[data-dock-resize='w']) {
    top: 14px;
    bottom: 14px;
    width: 5px;
    height: auto;
  }
  :global(.conversation-resize[data-resize-axis='both']) {
    width: 14px;
    height: 14px;
  }
  :global(.conversation-resize[data-dock-resize*='n']) {
    top: 0;
  }
  :global(.conversation-resize[data-dock-resize*='s']) {
    bottom: 0;
  }
  :global(.conversation-resize[data-dock-resize*='w']) {
    left: 0;
  }
  :global(.conversation-resize[data-dock-resize*='e']) {
    right: 0;
  }
  :global(.conversation-resize[data-dock-resize='ne']),
  :global(.conversation-resize[data-dock-resize='sw']) {
    cursor: nesw-resize;
  }
</style>

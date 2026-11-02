<script lang="ts" module>
  import type { DockPointerRect } from '$shared/dock-layout';

  /** What the shell owner needs: keep the native panel while closing and route input. */
  export interface DockEdgeConversationState {
    held: boolean;
    reveal: number;
    shell: DockPointerRect | null;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import type { DockPlacementSnapshot } from '$shared/dock-placement';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
  import { createRevealTween } from '$features/hud/utils/dock-shell-frames';
  import { DOCK_SHELL_REVEAL } from '$features/hud/utils/dock-motion';
  import {
    dockEdgeShellRect,
    dockLerpRect,
    type DockEdgeOpenOrigin,
  } from '$features/hud/utils/dock-edge-shell';
  import DockConversationSurface from './DockConversationSurface.svelte';

  /**
   * The side placement's conversation as one box beside the unchanged rail. Opened from
   * a side entry, it grows out of that entry's hover card (rect and radius) into the
   * panel, which main centres on the entry; it shrinks back into the card and fades on
   * close. Without an origin it grows from the rail side.
   */
  let {
    children,
    open,
    workspaceId,
    placement,
    shown,
    origin: cardOrigin = null,
    focusRequest = 0,
    focusComposerOnMount = false,
    onRegionsChange,
    onPopupStateChange,
    onStateChange,
  }: {
    children: Snippet;
    open: boolean;
    workspaceId: string | null;
    placement: DockPlacementSnapshot;
    /** The rail inside the placement surface. */
    shown: DockPointerRect;
    /** The clicked entry's hover card the box grows from and returns to. */
    origin?: DockEdgeOpenOrigin | null;
    focusRequest?: number;
    focusComposerOnMount?: boolean;
    onRegionsChange?: (regions: DockPointerRect[]) => void;
    onPopupStateChange?: (open: boolean) => void;
    onStateChange: (state: DockEdgeConversationState) => void;
  } = $props();

  // Rail and panel in the same window-local space.
  const rail = $derived({
    ...shown,
    x: placement.surface.x + shown.x,
    y: placement.surface.y + shown.y,
  });
  const panel = $derived(placement.sidePanel ?? null);
  const side = $derived(
    placement.placement.kind === 'edge' && placement.placement.side === 'left' ? 'left' : 'right',
  );
  let reducedMotion = $state(false);
  onMount(() => {
    reducedMotion = prefersReducedMotion();
    return onReducedMotionChange((value) => (reducedMotion = value));
  });
  let reveal = $state(0);
  // The box travels a few hundred pixels: the dock's large-shell timing keeps each frame small.
  const tween = createRevealTween(
    () => reveal,
    (value) => (reveal = value),
    DOCK_SHELL_REVEAL,
  );
  // Closing keeps the last panel and workspace so the shell shrinks with its content.
  let lastPanel = $state<DockPointerRect | null>(null);
  let lastWorkspace = $state<string | null>(null);
  // Re-anchored while open (another entry clicked): the box glides to its new place.
  let move = $state(1);
  let moveFrom: DockPointerRect | null = null;
  const mover = createRevealTween(
    () => move,
    (value) => (move = value),
    DOCK_SHELL_REVEAL,
  );
  $effect(() => {
    const next = panel;
    if (next) {
      const previous = untrack(() => lastPanel);
      const moved =
        previous &&
        untrack(() => reveal) >= 1 &&
        previous.y !== next.y &&
        previous.width === next.width &&
        previous.height === next.height;
      if (moved && !untrack(() => reducedMotion)) {
        moveFrom = untrack(() => shell) ?? previous;
        move = 0;
        mover.animate(1, false);
      }
      lastPanel = next;
    }
    if (workspaceId) lastWorkspace = workspaceId;
  });
  const wanted = $derived(open && !!workspaceId && !!panel);
  $effect(() => {
    const target = wanted ? 1 : 0;
    const instant = reducedMotion;
    untrack(() => tween.animate(target, instant));
  });
  const present = $derived(wanted || reveal > 0);
  // The box starts on the clicked entry's hover card (or rail-sized against the rail)
  // and grows into the panel.
  const origin = $derived(
    cardOrigin?.card ??
      (lastPanel && {
        ...rail,
        x: side === 'right' ? lastPanel.x + lastPanel.width - rail.width : lastPanel.x,
      }),
  );
  const shell = $derived.by(() => {
    if (!present || !lastPanel || !origin) return null;
    if (moveFrom && move < 1 && reveal >= 1) return dockLerpRect(moveFrom, lastPanel, move);
    return dockEdgeShellRect(origin, lastPanel, reveal);
  });
  let shellElement = $state<HTMLDivElement>();
  const inlineClip = $derived.by(() => {
    // Refresh the surface owner on every morph/glide frame, even without DOM mutations.
    const visible = shell;
    // Measure in viewport space, including the host offset in embedded previews.
    return () => (visible ? (shellElement?.getBoundingClientRect() ?? null) : null);
  });
  // The card's corners become the box's; closing fades only at the very end.
  const radius = $derived(32 + ((cardOrigin?.radius ?? 32) - 32) * (1 - reveal));
  const fade = $derived(wanted ? 1 : Math.min(1, reveal / 0.2));
  $effect(() => {
    const state = { held: present && !wanted, reveal: shell ? reveal : 0, shell };
    untrack(() => onStateChange(state));
  });
  onDestroy(() => {
    tween.cancel();
    mover.cancel();
    onStateChange({ held: false, reveal: 0, shell: null });
  });
  const settled = $derived(reveal >= 1);
  // Content follows the shell from the docked edge.
  const offset = $derived((1 - reveal) * 24 * (side === 'right' ? 1 : -1));
  // While gliding to a new entry, content rides with the box (a translate, no layout).
  const glide = $derived(shell && lastPanel && move < 1 ? shell.y - lastPanel.y : 0);
</script>

{#if shell && lastPanel && lastWorkspace}
  <!-- The conversation's only chrome: one fill, edge, radius and shadow. -->
  <div
    bind:this={shellElement}
    class="edge-shell"
    data-testid="dock-edge-shell"
    data-side={side}
    data-reveal={reveal}
    aria-hidden="true"
    style:left={`${shell.x}px`}
    style:top={`${shell.y}px`}
    style:width={`${shell.width}px`}
    style:height={`${shell.height}px`}
    style:border-radius={`${radius}px`}
    style:opacity={fade}
    style:--edge-chrome={reveal}
  ></div>
  <!-- While morphing, the panel shows only inside the shell; once open nothing is clipped. -->
  <div
    class="edge-panel"
    style:clip-path={settled
      ? undefined
      : `xywh(${shell.x}px ${shell.y}px ${shell.width}px ${shell.height}px round ${radius}px)`}
  >
    <div
      class="edge-panel"
      inert={!wanted}
      style:opacity={Math.max(0, Math.min(1, (reveal - 0.2) / 0.8))}
      style:translate={settled ? (glide ? `0 ${glide}px` : undefined) : `${offset}px 0`}
    >
      <DockConversationSurface
        workspaceId={lastWorkspace}
        active={wanted}
        resizable={wanted && settled}
        {focusRequest}
        {focusComposerOnMount}
        rect={lastPanel}
        clip={inlineClip}
        {onRegionsChange}
        {onPopupStateChange}
      >
        {@render children()}
      </DockConversationSurface>
    </div>
  </div>
{/if}

<style>
  .edge-shell {
    position: absolute;
    pointer-events: none;
    background: hsl(var(--popover));
    border: 1px solid hsl(var(--border) / var(--edge-chrome));
    /* Concentric with the composer card: its 16px radius plus the 16px lane inset. */
    border-radius: 32px;
  }
  .edge-shell::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--elevation-overlay);
    opacity: var(--edge-chrome);
  }
  .edge-panel {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>

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
  import { DOCK_FLOATING_SHADOW_MARGIN, type DockPlacementSnapshot } from '$shared/dock-placement';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
  import { createRevealSpring, createRevealFade } from '$features/hud/utils/dock-shell-frames';
  import { DOCK_SHELL_REVEAL } from '$features/hud/utils/dock-motion';
  import { dockLerpRect, type DockEdgeOpenOrigin } from '$features/hud/utils/dock-edge-shell';
  import { intersectDockRect } from '$features/hud/utils/dock-scroll';
  import DockConversationSurface from './DockConversationSurface.svelte';

  let {
    children,
    open,
    workspaceId,
    placement,
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
  const disclosure = createRevealSpring(
    () => reveal,
    (value) => (reveal = value),
    DOCK_SHELL_REVEAL,
  );
  const fade = createRevealFade(
    () => reveal,
    (value) => (reveal = value),
  );
  // Closing keeps the last panel and workspace so the shell shrinks with its content.
  let lastPanel = $state<DockPointerRect | null>(null);
  let lastWorkspace = $state<string | null>(null);
  // Re-anchored while open (another entry clicked): the box glides to its new place.
  let move = $state(1);
  let moveFrom: DockPointerRect | null = null;
  const mover = createRevealSpring(
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
        mover.cancel();
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
    const fadeOnly = reducedMotion;
    untrack(() => {
      if (fadeOnly) {
        disclosure.cancel();
        mover.cancel();
        move = 1;
        fade.animate(target);
      } else {
        fade.cancel();
        disclosure.animate(target, false);
      }
    });
  });
  const present = $derived(wanted || reveal > 0);
  const frame = $derived(
    lastPanel && moveFrom && move < 1 ? dockLerpRect(moveFrom, lastPanel, move) : lastPanel,
  );
  const offset = $derived(
    reducedMotion ? 0 : (1 - reveal) * (frame?.width ?? 0) * (side === 'right' ? 1 : -1),
  );
  const translated = $derived(frame && { ...frame, x: frame.x + offset });
  const viewport = $derived(
    lastPanel && {
      x: side === 'left' ? lastPanel.x : 0,
      y: 0,
      width:
        side === 'left'
          ? placement.windowBounds.width - lastPanel.x
          : lastPanel.x + lastPanel.width,
      height: placement.windowBounds.height,
    },
  );
  const shell = $derived(
    present && translated && viewport ? intersectDockRect(translated, viewport) : null,
  );
  let shellElement = $state<HTMLDivElement>();
  const inlineClip = $derived.by(() => {
    const visible = shell;
    const position = translated;
    return () => {
      const bounds = shellElement?.getBoundingClientRect();
      return visible && position && bounds
        ? {
            ...visible,
            x: bounds.x + visible.x - position.x,
            y: bounds.y + visible.y - position.y,
          }
        : { x: 0, y: 0, width: 0, height: 0 };
    };
  });
  $effect(() => {
    const state = { held: present && !wanted, reveal: shell ? reveal : 0, shell };
    untrack(() => onStateChange(state));
  });
  onDestroy(() => {
    disclosure.cancel();
    fade.cancel();
    mover.cancel();
    onStateChange({ held: false, reveal: 0, shell: null });
  });
  const settled = $derived(reveal >= 1);
  const shadowMargin = $derived(settled ? DOCK_FLOATING_SHADOW_MARGIN : 0);
  const glide = $derived(frame && lastPanel ? frame.y - lastPanel.y : 0);
  const opacity = $derived(reducedMotion ? reveal : 1);
  const clipRight = $derived(
    viewport ? placement.windowBounds.width - viewport.x - viewport.width : 0,
  );
</script>

{#if present && frame && lastPanel && lastWorkspace && viewport}
  <div class="edge-panel">
    <div class="edge-panel" style:clip-path={`inset(0 ${clipRight}px 0 ${viewport.x}px)`}>
      <div
        bind:this={shellElement}
        class="edge-shell"
        data-testid="dock-edge-shell"
        data-side={side}
        data-reveal={reveal}
        aria-hidden="true"
        style:left={`${frame.x}px`}
        style:top={`${frame.y}px`}
        style:width={`${frame.width}px`}
        style:height={`${frame.height}px`}
        style:transform={`translateX(${offset}px)`}
        style:opacity
      ></div>
      <div
        class="edge-panel"
        inert={!wanted}
        style:opacity
        style:transform={`translate(${offset}px, ${glide}px)`}
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
    <!-- Paint may use the existing transparent native margin; content and input keep their clip. -->
    <div
      class="edge-panel"
      aria-hidden="true"
      style:clip-path={`inset(0 ${Math.max(0, clipRight - shadowMargin)}px 0 ${Math.max(0, viewport.x - shadowMargin)}px)`}
    >
      <div
        class="edge-shadow"
        style:left={`${frame.x}px`}
        style:top={`${frame.y}px`}
        style:width={`${frame.width}px`}
        style:height={`${frame.height}px`}
        style:transform={`translateX(${offset}px)`}
        style:opacity
      ></div>
    </div>
  </div>
{/if}

<style>
  .edge-shell,
  .edge-shadow {
    position: absolute;
    pointer-events: none;
    border-radius: 32px;
  }
  .edge-shell {
    background: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    /* Concentric with the composer card: its 16px radius plus the 16px lane inset. */
    border-radius: 32px;
  }
  .edge-shadow {
    border: 1px solid transparent;
  }
  .edge-shadow::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--elevation-overlay);
  }
  .edge-panel {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>

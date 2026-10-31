<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import type { DockPointerRect } from '$shared/dock-layout';
  import { setOwnedPopupContext } from '$lib/components/ui/owned-popup-context';
  import { createDockConversationPopupOwner } from './dock-conversation-popup-owner';
  import { setDockConversationNoticeHost } from './DockConversationNotifications.svelte';
  import DockConversationResize from './DockConversationResize.svelte';

  let {
    children,
    workspaceId,
    focusRequest = 0,
    focusComposerOnMount = false,
    active = true,
    resizable = true,
    clip,
    rect,
    onRegionsChange,
    onPopupStateChange,
  }: {
    children: Snippet;
    workspaceId: string;
    focusRequest?: number;
    focusComposerOnMount?: boolean;
    active?: boolean;
    /** False while the visible shell still clips the panel edges (height settling). */
    resizable?: boolean;
    /** Inline only: current visible host ink in viewport CSS pixels. Detached panels omit it. */
    clip?: () => DockPointerRect | null;
    rect?: DockPointerRect;
    onRegionsChange?: (regions: DockPointerRect[]) => void;
    onPopupStateChange?: (open: boolean) => void;
  } = $props();
  let root = $state<HTMLDivElement>();
  let portalTarget = $state<HTMLDivElement>();
  let popupOwner = $state.raw<ReturnType<typeof createDockConversationPopupOwner>>();
  let popupWorkspace = $state<string | null>(null);
  let disposed = false;
  let lastWorkspace: string | null = null;
  let initialFocusPending = true;
  // A historical Focus Dock request must not steal focus on a later icon click.
  // svelte-ignore state_referenced_locally
  let lastFocusRequest = focusRequest;

  const popupsActive = () => !disposed && active && popupWorkspace === workspaceId;
  // The panel places the banner above its composer; the surface owns pointer regions.
  setDockConversationNoticeHost({
    get register() {
      return active && popupOwner ? popupOwner.registerNotification : null;
    },
    get key() {
      return workspaceId;
    },
    get active() {
      return active;
    },
  });
  setOwnedPopupContext({
    target: () => portalTarget,
    active: popupsActive,
    register: (element, close) => {
      if (popupOwner) return popupOwner.register(element, close);
      close?.();
      return () => {};
    },
  });

  onMount(() => {
    // Escape the conversation's clipping and animated shell without making the
    // transparent native window an input target. Only registered content opts in.
    const target = document.createElement('div');
    target.dataset.dockConversationPortals = '';
    target.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:var(--layer-modal,100);';
    document.body.append(target);
    portalTarget = target;
    popupWorkspace = workspaceId;
    popupOwner = createDockConversationPopupOwner({
      surface: () => root,
      target,
      active: popupsActive,
      onRegionsChange: (regions) => onRegionsChange?.(regions),
      onPopupStateChange: (open) => onPopupStateChange?.(open),
      clip: () => clip?.() ?? null,
    });
  });

  $effect(() => {
    const owner = popupOwner;
    const target = portalTarget;
    const id = workspaceId;
    const enabled = active;
    rect;
    // A new clip function means the visible ink moved; re-measure inline regions.
    clip;
    if (!owner || !target) return;
    untrack(() => {
      if (popupWorkspace !== id) {
        owner.close();
        popupWorkspace = id;
      }
      target.dataset.workspaceId = id;
      target.hidden = !enabled;
      target.inert = !enabled;
      owner.refresh();
    });
  });

  $effect(() => {
    const element = root;
    const id = workspaceId;
    const request = focusRequest;
    const composerOnMount = focusComposerOnMount;
    if (!element || !active) return;
    untrack(() => {
      const changed = id !== lastWorkspace;
      // A switch to the conversation a click asked for focuses its composer too.
      const explicitFocus =
        request !== lastFocusRequest || ((initialFocusPending || changed) && composerOnMount);
      initialFocusPending = false;
      lastFocusRequest = request;
      lastWorkspace = id;
      if (!explicitFocus && !changed) return;
      // The composer can render a few frames after the conversation: retry briefly.
      const focus = (attempt: number): void => {
        if (disposed || !active || workspaceId !== id || !element.isConnected) return;
        const composer = explicitFocus
          ? element.querySelector<HTMLElement>('[data-dock-conversation-composer]:not(:disabled)')
          : null;
        if (explicitFocus && !composer && attempt < 20) {
          setTimeout(() => focus(attempt + 1), 50);
          return;
        }
        (composer ?? element.querySelector<HTMLElement>('[data-dock-conversation-back]'))?.focus({
          preventScroll: true,
        });
      };
      void tick().then(() => focus(0));
    });
  });
  onDestroy(() => {
    disposed = true;
    popupOwner?.destroy();
    portalTarget?.remove();
  });
</script>

<div
  bind:this={root}
  class="conversation-surface"
  data-dock-app-palette
  class:detached={!!rect}
  data-dock-surface={rect ? 'detached' : undefined}
  data-testid="dock-conversation-surface"
  id={rect ? 'dock-side-conversation' : undefined}
  data-workspace-id={workspaceId}
  style:left={rect ? `${rect.x}px` : undefined}
  style:top={rect ? `${rect.y}px` : undefined}
  style:width={rect ? `${rect.width}px` : undefined}
  style:height={rect ? `${rect.height}px` : undefined}
>
  {#if rect}
    <!-- Only content is rounded: corner resize handles stay hit-testable at the corners. -->
    <div class="detached-content">{@render children()}</div>
  {:else}
    {@render children()}
  {/if}
  <DockConversationResize active={active && resizable} {workspaceId} surface={root} />
</div>

<style>
  .conversation-surface {
    /* Block depth sits inside the composer lane's 16px inset, so Send stays clear. */
    --dock-resize-depth-block: 12px;
    /* Handles overlay the edge and never take layout space (a gutter shifted every lane
       inward), so the side panel's lanes match notch and floating. The inline depth stays
       within the transcript scrollbar's transparent outer border, clear of its thumb. */
    --dock-resize-depth-inline: 4px;
    --dock-resize-corner: 16px;
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    pointer-events: auto;
  }
  /* The side panel draws no chrome of its own: the edge shell behind it is the one box
     shared with the rail. */
  .detached {
    position: absolute;
    color: hsl(var(--foreground));
  }
  /* Same corners as the edge shell (composer card 16 + lane inset 16), so content never
     paints square corners over the rounded box. */
  .detached-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: 32px;
  }
</style>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import type { DockPointerRect } from '$shared/dock-layout';
  import { setOwnedPopupContext } from '$lib/components/ui/owned-popup-context';
  import { createDockConversationPopupOwner } from './dock-conversation-popup-owner';
  import DockConversationNotifications from './DockConversationNotifications.svelte';
  import DockConversationResize from './DockConversationResize.svelte';

  let {
    children,
    workspaceId,
    focusRequest = 0,
    focusComposerOnMount = false,
    active = true,
    rect,
    onRegionsChange,
    onPopupStateChange,
  }: {
    children: Snippet;
    workspaceId: string;
    focusRequest?: number;
    focusComposerOnMount?: boolean;
    active?: boolean;
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
    });
  });

  $effect(() => {
    const owner = popupOwner;
    const target = portalTarget;
    const id = workspaceId;
    const enabled = active;
    rect;
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
      const explicitFocus =
        request !== lastFocusRequest || (initialFocusPending && composerOnMount);
      const changed = id !== lastWorkspace;
      initialFocusPending = false;
      lastFocusRequest = request;
      lastWorkspace = id;
      if (!explicitFocus && !changed) return;
      void tick().then(() => {
        if (disposed || !active || workspaceId !== id || !element.isConnected) return;
        const composer = explicitFocus
          ? element.querySelector<HTMLElement>('[data-dock-conversation-composer]:not(:disabled)')
          : null;
        (composer ?? element.querySelector<HTMLElement>('[data-dock-conversation-back]'))?.focus({
          preventScroll: true,
        });
      });
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
  {@render children()}
  <DockConversationResize {active} {workspaceId} surface={root} />
  {#if active && popupOwner}
    {#key workspaceId}
      <DockConversationNotifications register={popupOwner.registerNotification} />
    {/key}
  {/if}
</div>

<style>
  .conversation-surface {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    pointer-events: auto;
  }
  .detached {
    position: absolute;
    border: 1px solid hsl(var(--border));
    border-radius: 16px;
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
    box-shadow: var(--elevation-overlay);
  }
</style>

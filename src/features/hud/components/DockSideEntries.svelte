<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DockWorkspaceAvatar from './DockWorkspaceAvatar.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import { faPen } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    DOCK_ISLAND_WIDTH,
    DOCK_PREVIEW_GAP,
    getDockHorizontalLayout,
    getDockPreviewTop,
    type DockPointerRect,
  } from '$shared/dock-layout';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import { DOCK_HOVER_SCALE_MS, getDockProximityScale } from '$features/hud/utils/dock-motion';
  import { intersectDockRect, revealDockItem } from '$features/hud/utils/dock-scroll';
  import { spring } from '$lib/motion';

  let {
    workspaces,
    side,
    railX,
    railY,
    railHeight,
    windowWidth,
    windowHeight,
    reducedMotion,
    disabled,
    staticData = false,
    focusRequest = 0,
    closeRequest = 0,
    pinnedWorkspaceId = null,
    onOpen,
    onFeedback,
    onRegionsChange,
    onPreviewChange,
  }: {
    workspaces: DockWorkspaceView[];
    side: 'left' | 'right';
    railX: number;
    railY: number;
    railHeight: number;
    windowWidth: number;
    windowHeight: number;
    reducedMotion: boolean;
    disabled: boolean;
    staticData?: boolean;
    focusRequest?: number;
    closeRequest?: number;
    pinnedWorkspaceId?: string | null;
    onOpen: (id: string) => void;
    onFeedback: (id: string, title: string) => void;
    onRegionsChange: (regions: DockPointerRect[]) => void;
    onPreviewChange: (open: boolean) => void;
  } = $props();

  const assistantId = 'dock:assistant';
  const entries = $derived([
    { id: assistantId, title: m.dock_assistant_label(), item: null },
    ...workspaces.map((item) => ({
      id: String(item.workspace.id),
      title: item.workspace.title?.trim() || m.workspace_links_untitled_label(),
      item,
    })),
  ]);
  let root = $state<HTMLDivElement>();
  let rail = $state<HTMLElement>();
  let card = $state<HTMLDivElement>();
  let bridge = $state<HTMLDivElement>();
  let buttons = $state<Record<string, HTMLButtonElement | null>>({});
  let previewId = $state<string | null>(null);
  let center = $state<number | null>(null);
  let previewTop = $state(8);
  let positioned = $state(false);
  let anchorRegion = $state<DockPointerRect | null>(null);
  let pointerY: number | null = null;
  let keyboardPreview = $state(false);
  let hovered = false;
  let pointerFocusing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let sampleUntil = 0;
  let focusRevealUntil = 0;
  let disposed = false;
  let lastFocusRequest = 0;
  const preview = $derived(entries.find((entry) => entry.id === previewId));
  const availableWidth = $derived(side === 'left' ? windowWidth - railX - 40 : railX);
  const previewWidth = $derived(
    Math.min(420, getDockHorizontalLayout(availableWidth + DOCK_ISLAND_WIDTH).preview.width),
  );
  const previewLeft = $derived(
    side === 'left' ? railX + 40 + DOCK_PREVIEW_GAP : railX - DOCK_PREVIEW_GAP - previewWidth,
  );
  const scrollGutter = $derived(Math.max(0, Math.min(8, availableWidth)));

  function region(element: HTMLElement): DockPointerRect {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  function measure(): void {
    if (disposed) return;
    // Focus is restored before proximity scaling finishes. Keep the focused
    // target inside the scrollport throughout that bounded transform interval.
    const focused = document.activeElement;
    if (focusRevealUntil > 0) {
      if (focused instanceof HTMLElement && rail?.contains(focused)) revealDockItem(focused);
      // Include the final settled frame before releasing scroll ownership.
      if (performance.now() >= focusRevealUntil) focusRevealUntil = 0;
    }
    const anchor = previewId ? buttons[previewId] : null;
    const viewport = rail ? region(rail) : null;
    if (card && anchor && root && viewport) {
      const rect = intersectDockRect(region(anchor), viewport);
      if (!rect) {
        closePreview();
        return;
      }
      anchorRegion = rect;
      previewTop = getDockPreviewTop({
        itemTop: rect.y - root.getBoundingClientRect().top,
        itemHeight: rect.height,
        previewHeight: card.getBoundingClientRect().height,
        viewportHeight: windowHeight,
        shadowInset: 8,
      });
      positioned = true;
    }
    void tick().then(() => {
      if (disposed) return;
      onRegionsChange([
        ...Object.values(buttons)
          .filter((button): button is HTMLButtonElement => !!button?.isConnected)
          .map((button) => (viewport ? intersectDockRect(region(button), viewport) : null))
          .filter((rect): rect is DockPointerRect => rect !== null),
        ...(card && positioned ? [region(card)] : []),
        ...(bridge && positioned ? [region(bridge)] : []),
      ]);
    });
  }
  function scheduleMeasure(): void {
    if (frame !== undefined || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
      if (performance.now() < sampleUntil) scheduleMeasure();
    });
  }
  function cancelClose(): void {
    clearTimeout(closeTimer);
  }
  function closePreview(): void {
    focusRevealUntil = 0;
    const focused = document.activeElement;
    if (!keyboardPreview && focused instanceof HTMLElement && root?.contains(focused))
      focused.blur();
    cancelClose();
    previewId = null;
    anchorRegion = null;
    center = null;
    positioned = false;
    hovered = false;
    keyboardPreview = false;
    pointerFocusing = false;
    scheduleMeasure();
  }
  function scheduleClose(): void {
    cancelClose();
    closeTimer = setTimeout(() => {
      if (!hovered && !(keyboardPreview && root?.contains(document.activeElement))) closePreview();
    }, spring.fast.settleMs);
  }
  function leave(): void {
    hovered = false;
    scheduleClose();
  }
  function leaveFocus(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
    scheduleClose();
  }
  function enter(): void {
    hovered = true;
    cancelClose();
  }
  function show(id: string, keyboard = false): void {
    if (disabled || pinnedWorkspaceId) return;
    cancelClose();
    // Keep the existing surface visible when moving directly between neighbors.
    if (previewId === null) positioned = false;
    keyboardPreview = keyboard;
    previewId = id;
    scheduleMeasure();
  }
  function updateMagnification(event: PointerEvent): void {
    if (disabled || (event.pointerType && event.pointerType !== 'mouse') || !rail) return;
    pointerY = event.clientY;
    updateCenter();
  }
  function updateCenter(): void {
    if (!rail || pointerY === null) return;
    center = Math.max(
      0,
      Math.min(
        entries.length - 1,
        (pointerY - rail.getBoundingClientRect().top + rail.scrollTop - 19) / 32,
      ),
    );
  }
  function scroll(): void {
    if (hovered && !keyboardPreview) updateCenter();
    scheduleMeasure();
  }
  function navigate(event: KeyboardEvent, index: number): void {
    if (event.key === (side === 'left' ? 'ArrowRight' : 'ArrowLeft')) {
      event.preventDefault();
      show(entries[index].id, true);
      void tick().then(() =>
        card?.querySelector<HTMLButtonElement>('[data-testid="dock-row-feedback"]')?.focus(),
      );
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
    buttons[entries[next].id]?.focus({ preventScroll: true });
    const button = buttons[entries[next].id];
    if (button) revealDockItem(button);
  }
  $effect(() => {
    center;
    reducedMotion;
    railX;
    railY;
    railHeight;
    windowWidth;
    windowHeight;
    untrack(() => {
      sampleUntil = performance.now() + (reducedMotion ? 0 : DOCK_HOVER_SCALE_MS + 16);
      scheduleMeasure();
    });
  });
  $effect(() => {
    const element = card;
    previewId;
    untrack(scheduleMeasure);
    if (!element) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  $effect(() => {
    previewTop;
    positioned;
    untrack(scheduleMeasure);
  });
  $effect(() => onPreviewChange(previewId !== null));
  $effect(() => {
    if (
      disabled ||
      pinnedWorkspaceId ||
      (previewId && !entries.some((entry) => entry.id === previewId))
    )
      untrack(closePreview);
  });
  $effect(() => {
    closeRequest;
    untrack(() => {
      if (root?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      closePreview();
    });
  });
  $effect(() => {
    if (!focusRequest || focusRequest === lastFocusRequest) return;
    lastFocusRequest = focusRequest;
    void tick().then(() => {
      if (!disposed && !disabled) {
        pointerFocusing = false;
        buttons[assistantId]?.focus();
        show(assistantId, true);
      }
    });
  });
  onDestroy(() => {
    disposed = true;
    cancelClose();
    if (frame !== undefined) cancelAnimationFrame(frame);
    onRegionsChange([]);
    onPreviewChange(false);
  });
</script>

{#snippet penIcon()}<Fa icon={faPen} class="size-4" />{/snippet}
<svelte:window onblur={closePreview} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={root}
  class="side-entries"
  data-dock-surface="detached"
  data-side={side}
  class:reduced-motion={reducedMotion}
  style:--dock-hover-scale-ms={`${DOCK_HOVER_SCALE_MS}ms`}
  onpointerdowncapture={() => {
    focusRevealUntil = 0;
    pointerFocusing = true;
    keyboardPreview = false;
  }}
  onpointerupcapture={() => {
    pointerFocusing = false;
  }}
  onpointercancelcapture={() => {
    pointerFocusing = false;
  }}
  onkeydowncapture={() => {
    pointerFocusing = false;
    keyboardPreview = true;
  }}
>
  <nav
    bind:this={rail}
    class="side-rail"
    aria-label={m.dock_workspaces_ariaLabel()}
    data-dock-scroll
    style:left={`${railX - (side === 'right' ? scrollGutter : 0)}px`}
    style:top={`${railY + 39}px`}
    style:height={`${Math.max(0, railHeight - 39)}px`}
    style:width={`${40 + scrollGutter}px`}
    style:padding-left={`${side === 'right' ? scrollGutter : 0}px`}
    style:padding-right={`${side === 'left' ? scrollGutter : 0}px`}
    onscroll={scroll}
    onwheel={() => (focusRevealUntil = 0)}
    onpointerenter={enter}
    onpointermove={updateMagnification}
    onpointerleave={() => {
      center = null;
      pointerY = null;
      leave();
    }}
  >
    <div class="side-rail-items">
      {#each entries as entry, index (entry.id)}
        {@const scale = reducedMotion ? 1 : getDockProximityScale(index, center)}
        <Button
          bind:ref={() => buttons[entry.id] ?? null, (button) => (buttons[entry.id] = button)}
          variant="ghost"
          size="icon-sm"
          class="side-entry"
          {disabled}
          aria-label={entry.title}
          aria-describedby={entry.item ? `dock-side-status-${entry.id}` : undefined}
          aria-current={pinnedWorkspaceId === entry.id ? true : undefined}
          aria-expanded={pinnedWorkspaceId === entry.id || previewId === entry.id}
          aria-controls={pinnedWorkspaceId === entry.id
            ? 'dock-side-conversation'
            : previewId === entry.id
              ? 'dock-side-preview'
              : undefined}
          data-dock-entry={entry.id}
          data-dock-scroll-item
          data-dock-scale={scale}
          style={`--dock-item-scale: ${scale}; z-index: ${Math.round(scale * 100)}`}
          onpointerenter={(event) => {
            if (!event.pointerType || event.pointerType === 'mouse') {
              enter();
              updateMagnification(event);
              show(entry.id);
            }
          }}
          onfocus={(event) => {
            revealDockItem(event.currentTarget);
            center = index;
            focusRevealUntil = performance.now() + (reducedMotion ? 0 : DOCK_HOVER_SCALE_MS);
            sampleUntil = Math.max(sampleUntil, focusRevealUntil);
            show(entry.id, !pointerFocusing && event.currentTarget.matches(':focus-visible'));
            scheduleMeasure();
          }}
          onblur={(event) => {
            focusRevealUntil = 0;
            leaveFocus(event);
          }}
          onkeydown={(event) => navigate(event, index)}
          onclick={() => onOpen(entry.id)}
        >
          {#if entry.item}<DockWorkspaceAvatar
              item={entry.item}
              descriptionId={`dock-side-status-${entry.id}`}
            />{:else}<AgentAvatar specialist="chief-of-staff" variant="standard" />{/if}
        </Button>
      {/each}
    </div>
  </nav>
  {#if preview && !disabled && !pinnedWorkspaceId}
    <div
      bind:this={bridge}
      class="preview-bridge"
      role="presentation"
      style:left={`${side === 'left' ? railX + 40 : railX - DOCK_PREVIEW_GAP}px`}
      style:top={`${anchorRegion?.y ?? railY + 39}px`}
      style:height={`${anchorRegion?.height ?? 0}px`}
      style:width={`${DOCK_PREVIEW_GAP}px`}
      style:visibility={positioned ? 'visible' : 'hidden'}
      onpointerenter={enter}
      onpointerleave={leave}
    ></div>
    <div
      bind:this={card}
      id="dock-side-preview"
      class="side-preview"
      class:positioned
      class:keyboard-preview={keyboardPreview}
      role="presentation"
      data-testid="dock-preview"
      data-preview-workspace-id={preview.id}
      style:left={`${previewLeft}px`}
      style:top={`${previewTop}px`}
      style:width={`${previewWidth}px`}
      style:max-height={`${Math.max(0, windowHeight - 16)}px`}
      style:visibility={positioned ? 'visible' : 'hidden'}
      onpointerenter={enter}
      onpointerleave={leave}
      onfocusin={(event) => {
        if (!pointerFocusing && (event.target as HTMLElement).matches(':focus-visible'))
          keyboardPreview = true;
        cancelClose();
      }}
      onfocusout={leaveFocus}
    >
      <div inert class="preview-content">
        {#if preview.item}
          <WorkspaceHoverCard
            workspace={preview.item.workspace}
            {staticData}
            loadAgentSessions={false}
          />
        {:else}
          <section class="assistant-preview p-4 text-foreground">
            <h2 class="type-body font-medium">{m.dock_assistant_label()}</h2>
            <p class="type-caption mt-1 text-muted-foreground">{m.dock_assistant_description()}</p>
          </section>
        {/if}
      </div>
      <div class="preview-action">
        <Button
          variant="ghost"
          size="icon-sm"
          iconOnly
          aria-label={`${m.dock_feedback_label()}: ${preview.title}`}
          title={`${m.dock_feedback_label()}: ${preview.title}`}
          data-testid="dock-row-feedback"
          data-workspace-id={preview.id}
          onclick={() => onFeedback(preview.id, preview.title)}
        >
          {@render penIcon()}
        </Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .side-entries {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .side-entries :global(button:not(:disabled)) {
    cursor: pointer;
  }
  .side-rail {
    position: absolute;
    box-sizing: border-box;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    pointer-events: auto;
  }
  .side-rail-items {
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-block: 5px 8px;
  }
  .side-rail :global(.side-entry) {
    position: relative;
    flex: none;
    transform: scale(var(--dock-item-scale, 1));
    transform-origin: left center;
    transition: transform var(--dock-hover-scale-ms) var(--spring-moderate-ease);
  }
  [data-side='right'] .side-rail :global(.side-entry) {
    transform-origin: right center;
  }
  .preview-bridge {
    position: absolute;
    pointer-events: auto;
  }
  .side-preview {
    position: absolute;
    pointer-events: auto;
    overflow: auto;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--popover));
    box-shadow: var(--elevation-overlay);
    opacity: 0;
    transition: opacity var(--spring-fast) linear;
    overscroll-behavior: contain;
  }
  .side-preview.positioned {
    opacity: 1;
  }
  .preview-content :global([data-workspace-hover-card]) {
    width: 100%;
    max-width: 100%;
    background: transparent;
    border-radius: 0;
    box-shadow: none;
  }
  .preview-content :global([data-workspace-hover-card-header]),
  .preview-content :global([data-workspace-hover-card-columns]) {
    padding-inline: 16px;
  }
  .preview-content :global([data-workspace-hover-card-identity]) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 12px;
  }
  .preview-content :global([data-workspace-hover-card-identity] > div:first-child) {
    display: contents;
  }
  .preview-content :global([data-workspace-hover-card-title]) {
    grid-column: 1 / -1;
    grid-row: 1;
    padding-right: 32px;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .preview-content :global([data-workspace-hover-card-repo]) {
    grid-column: 1;
    grid-row: 2;
    margin-top: 0;
  }
  .preview-content :global([data-workspace-hover-card-status]) {
    grid-column: 2;
    grid-row: 2;
    align-self: start;
  }
  .preview-content :global([data-workspace-hover-card-summary]) {
    grid-column: 1 / -1;
    grid-row: 3;
    margin-top: 0;
  }
  .assistant-preview h2 {
    padding-right: 32px;
  }
  .side-preview.keyboard-preview,
  .reduced-motion .side-preview {
    transition: none;
  }
  .preview-action {
    position: absolute;
    top: 12px;
    right: 12px;
  }
  .reduced-motion .side-rail :global(.side-entry) {
    transition: none;
  }
</style>

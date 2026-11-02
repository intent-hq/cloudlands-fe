<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockPointerRect } from '$shared/dock-layout';

  let {
    feedback,
    onDismiss,
    onRegionsChange,
    anchor,
  }: {
    feedback: { message: string; retry?: () => void } | null;
    anchor?: {
      rect: DockPointerRect;
      side?: 'left' | 'right';
      viewport: { width: number; height: number };
      topInset?: number;
    };
    onDismiss: () => void;
    onRegionsChange: (regions: DockPointerRect[]) => void;
  } = $props();
  let container: HTMLDivElement;
  let position = $state<{ x: number; y: number } | null>(null);
  let disposed = false;
  let regionFrame: number | undefined;
  let measurementVersion = 0;

  function invalidatePublication(): number {
    measurementVersion += 1;
    if (regionFrame !== undefined) cancelAnimationFrame(regionFrame);
    regionFrame = undefined;
    return measurementVersion;
  }

  function publishAfterPosition(version: number): void {
    // Flush the host's reactive position before reading its interactive bounds.
    void tick().then(() => {
      if (disposed || version !== measurementVersion) return;
      regionFrame = requestAnimationFrame(() => {
        regionFrame = undefined;
        if (disposed || version !== measurementVersion) return;
        const element = container.querySelector<HTMLElement>('[data-dock-action-feedback]');
        if (!element) return onRegionsChange([]);
        const { x, y, width, height } = element.getBoundingClientRect();
        onRegionsChange([{ x, y, width, height }]);
      });
    });
  }

  function measure(): void {
    if (disposed || !container) return;
    const version = invalidatePublication();
    const element = container.querySelector<HTMLElement>('[data-dock-action-feedback]');
    if (!element) {
      position = null;
      onRegionsChange([]);
      return;
    }
    if (anchor) {
      const { width, height } = element.getBoundingClientRect();
      const { rect, viewport, side } = anchor;
      const top = Math.max(8, anchor.topInset ?? 8);
      const preferredX =
        side === 'left'
          ? rect.x + rect.width + 6
          : side === 'right'
            ? rect.x - width - 6
            : rect.x + (rect.width - width) / 2;
      const below = rect.y + rect.height + 8;
      const above = rect.y - height - 8;
      const preferredY = side
        ? rect.y + (rect.height - height) / 2
        : below + height <= viewport.height - 8
          ? below
          : above >= top
            ? above
            : rect.y + rect.height - height - 8;
      position = {
        x: Math.max(8, Math.min(preferredX, viewport.width - width - 8)),
        y: Math.max(top, Math.min(preferredY, viewport.height - height - 8)),
      };
    }
    publishAfterPosition(version);
  }

  $effect(() => {
    anchor;
    feedback;
    untrack(() => {
      void tick().then(measure);
    });
  });

  onMount(() => {
    const observer = new MutationObserver(measure);
    const resize = new ResizeObserver(measure);
    observer.observe(container, { childList: true, subtree: true });
    resize.observe(container);
    measure();
    return () => {
      disposed = true;
      invalidatePublication();
      observer.disconnect();
      resize.disconnect();
      onRegionsChange([]);
    };
  });
</script>

<div
  bind:this={container}
  class="dock-feedback-host"
  data-dock-surface={anchor ? 'detached' : undefined}
  style:left={anchor ? `${position?.x ?? 0}px` : undefined}
  style:top={anchor ? `${position?.y ?? 0}px` : undefined}
  style:right={anchor ? 'auto' : undefined}
  style:bottom={anchor ? 'auto' : undefined}
  style:width={anchor ? `${Math.max(0, Math.min(320, anchor.viewport.width - 16))}px` : undefined}
  style:visibility={anchor && !position ? 'hidden' : undefined}
>
  {#if feedback}
    <section
      data-dock-action-feedback
      class="dock-feedback type-caption"
      aria-busy={!feedback.retry}
      style:max-height={anchor
        ? `${Math.max(0, anchor.viewport.height - Math.max(8, anchor.topInset ?? 8) - 8)}px`
        : undefined}
      style:overflow-y={anchor ? 'auto' : undefined}
    >
      <p role="status">{feedback.message}</p>
      {#if feedback.retry}
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onclick={feedback.retry}
            >{m.ui_errorToast_retry_label()}</Button
          >
          <Button variant="ghost" size="sm" onclick={onDismiss}
            >{m.annotation_bootstrapClose_label()}</Button
          >
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .dock-feedback-host {
    position: absolute;
    left: 16px;
    right: 48px;
    bottom: 16px;
    z-index: 10;
    pointer-events: none;
  }
  .dock-feedback {
    display: grid;
    gap: 8px;
    width: fit-content;
    max-width: 100%;
    padding: 12px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    box-shadow: var(--elevation-overlay);
    pointer-events: auto;
  }
</style>

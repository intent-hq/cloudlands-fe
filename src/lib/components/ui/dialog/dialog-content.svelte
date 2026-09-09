<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { crispOut, springIn } from '$lib/motion';
  import DialogOverlay from './dialog-overlay.svelte';
  import { createOverlayPresence, overlayMotion, useOverlayOpen } from './overlay-motion.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';
  import { useSize } from '$lib/components/ui/size-context';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    container = null,
    size = 'sm',
    forceMount = false,
    showCloseButton = true,
    closeDisabled = false,
    closeLabel = m.ui_dialog_close_ariaLabel(),
    role = 'dialog',
    onInteractOutside,
    children,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: DialogPrimitive.PortalProps;
    container?: HTMLElement | null;
    size?: 'sm' | 'lg';
    showCloseButton?: boolean;
    closeDisabled?: boolean;
    closeLabel?: string;
    role?: 'dialog' | 'alertdialog';
    children: Snippet;
  } = $props();

  const rootOpen = useOverlayOpen();
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const density = useSize();
  const open = () => forceMount || rootOpen();
  const presence = createOverlayPresence(open);

  // Interactions inside a lightbox stacked above the dialog (see
  // ImageLightbox's data-image-lightbox-root) are not outside interactions:
  // closing the lightbox must not also dismiss the dialog.
  function handleInteractOutside(e: Parameters<NonNullable<typeof onInteractOutside>>[0]) {
    if (e.target instanceof Element && e.target.closest('[data-image-lightbox-root]')) {
      e.preventDefault();
    }
    onInteractOutside?.(e);
  }
</script>

{#if presence.mounted}
  <DialogPrimitive.Portal {...portalProps} to={container ?? portalProps?.to}>
    <DialogOverlay contained={Boolean(container)} />
    <DialogPrimitive.Content
      bind:ref
      forceMount
      {...restProps}
      onInteractOutside={handleInteractOutside}
    >
      {#snippet child({ props })}
        {#if open()}
          <div
            {...props}
            {role}
            data-slot="dialog-content"
            data-overlay-surface
            class={cn(
              container ? 'absolute' : 'fixed',
              'dialog-editorial-content overlay-surface left-1/2 top-1/2 z-[var(--layer-modal)] grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-6 text-popover-foreground outline-none motion-reduce:animate-none motion-reduce:transition-none',
              size === 'sm' && (density === 'compact' ? 'max-w-90' : 'max-w-100'),
              size === 'lg' && (density === 'compact' ? 'max-w-120' : 'max-w-135'),
              surfaceClasses(surface),
              className,
            )}
            data-surface-level={surface}
            in:springIn={overlayMotion.dialog.enter}
            out:crispOut={overlayMotion.dialog.exit}
            onoutroend={presence.finishExit}
          >
            {@render children?.()}
            {#if showCloseButton}
              <DialogPrimitive.Close disabled={closeDisabled}>
                {#snippet child({ props: closeProps })}
                  <Button
                    {...closeProps}
                    aria-label={closeLabel}
                    disabled={closeDisabled}
                    variant="ghost"
                    size="icon-sm"
                    iconOnly
                    class="absolute right-3 top-3 text-muted-foreground"
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </Button>
                {/snippet}
              </DialogPrimitive.Close>
            {/if}
          </div>
        {/if}
      {/snippet}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
{/if}

<style>
  :global(.dialog-editorial-content) {
    max-height: calc(100dvh - 2rem);
  }
</style>

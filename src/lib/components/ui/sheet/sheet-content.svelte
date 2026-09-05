<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  export const sheetVariants = tv({
    base: 'sheet-editorial-content text-popover-foreground fixed z-[var(--layer-modal)] flex flex-col overflow-y-auto overscroll-contain outline-none motion-reduce:animate-none motion-reduce:transition-none',
    variants: {
      side: {
        top: 'inset-x-2 top-0 rounded-b-(--radius-large) sm:inset-x-4',
        bottom: 'inset-x-2 bottom-0 rounded-t-(--radius-large) sm:inset-x-4',
        left: 'inset-y-2 left-0 rounded-r-(--radius-large)',
        right: 'inset-y-2 right-0 rounded-l-(--radius-large)',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  });

  export type Side = VariantProps<typeof sheetVariants>['side'];
</script>

<script lang="ts">
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { crispOut, springIn } from '$lib/motion';
  import SheetOverlay from './sheet-overlay.svelte';
  import {
    createOverlayPresence,
    overlayMotion,
    useOverlayOpen,
  } from '../dialog/overlay-motion.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';

  let {
    ref = $bindable(null),
    class: className,
    side = 'right',
    portalProps,
    forceMount = false,
    showCloseButton = true,
    closeDisabled = false,
    closeLabel = m.ui_sheet_close_label(),
    onInteractOutside,
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: SheetPrimitive.PortalProps;
    side?: Side;
    showCloseButton?: boolean;
    closeDisabled?: boolean;
    closeLabel?: string;
    children: Snippet;
  } = $props();

  const rootOpen = useOverlayOpen();
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const open = () => forceMount || rootOpen();
  const presence = createOverlayPresence(open);
  const motion = $derived(overlayMotion.sheet(side));

  // Interactions inside a lightbox stacked above the sheet (see
  // ImageLightbox's data-image-lightbox-root) are not outside interactions:
  // closing the lightbox must not also dismiss the sheet.
  function handleInteractOutside(e: Parameters<NonNullable<typeof onInteractOutside>>[0]) {
    if (e.target instanceof Element && e.target.closest('[data-image-lightbox-root]')) {
      e.preventDefault();
    }
    onInteractOutside?.(e);
  }
</script>

{#if presence.mounted}
  <SheetPrimitive.Portal {...portalProps}>
    <SheetOverlay />
    <SheetPrimitive.Content
      bind:ref
      forceMount
      {...restProps}
      onInteractOutside={handleInteractOutside}
    >
      {#snippet child({ props })}
        {#if open()}
          <div
            {...props}
            data-slot="sheet-content"
            data-side={side}
            class={cn(sheetVariants({ side }), surfaceClasses(surface), className)}
            data-surface-level={surface}
            in:springIn={motion.enter}
            out:crispOut={motion.exit}
            onoutroend={presence.finishExit}
          >
            {@render children?.()}
            {#if showCloseButton}
              <SheetPrimitive.Close disabled={closeDisabled}>
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
              </SheetPrimitive.Close>
            {/if}
          </div>
        {/if}
      {/snippet}
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
{/if}

<style>
  :global(.sheet-editorial-content[data-side='left']),
  :global(.sheet-editorial-content[data-side='right']) {
    width: min(26rem, calc(100% - 0.5rem));
    height: calc(100% - 1rem);
  }

  :global(.sheet-editorial-content[data-side='top']),
  :global(.sheet-editorial-content[data-side='bottom']) {
    max-height: calc(100dvh - 0.5rem);
  }
</style>

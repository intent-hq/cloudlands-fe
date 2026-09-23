<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { crispOut, springIn } from '$lib/motion';
  import DialogOverlay from './dialog-overlay.svelte';
  import {
    createOverlayPresence,
    overlayMotion,
    useOverlayOpen,
    useOverlayStatic,
  } from './overlay-motion.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';
  import { useSize } from '$lib/components/ui/size-context';
  import { provideDialogPortalTarget } from './dialog-portal-context';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    container = null,
    size = 'default',
    forceMount = false,
    showCloseButton = true,
    closeDisabled = false,
    closeLabel = m.ui_dialog_close_ariaLabel(),
    role = 'dialog',
    onInteractOutside,
    onOpenAutoFocus,
    onCloseAutoFocus,
    trapFocus,
    preventScroll,
    children,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: DialogPrimitive.PortalProps;
    container?: HTMLElement | null;
    size?: 'sm' | 'default' | 'lg';
    showCloseButton?: boolean;
    closeDisabled?: boolean;
    closeLabel?: string;
    role?: 'dialog' | 'alertdialog';
    children: Snippet;
  } = $props();

  const rootOpen = useOverlayOpen();
  const staticPosition = useOverlayStatic();
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const density = useSize();
  const open = () => forceMount || rootOpen();
  const presence = createOverlayPresence(open);
  provideDialogPortalTarget(() => ref);

  // Interactions inside a lightbox stacked above the dialog (see
  // ImageLightbox's data-image-lightbox-root) are not outside interactions:
  // closing the lightbox must not also dismiss the dialog.
  function handleInteractOutside(e: Parameters<NonNullable<typeof onInteractOutside>>[0]) {
    if (e.target instanceof Element && e.target.closest('[data-image-lightbox-root]')) {
      e.preventDefault();
    }
    onInteractOutside?.(e);
  }

  function handleOpenAutoFocus(event: Event) {
    onOpenAutoFocus?.(event);
    if (event.defaultPrevented || !ref) return;

    const belongsToDialog = (element: HTMLElement) =>
      element.closest('[data-slot="dialog-content"]') === ref;
    const canFocus = (element: HTMLElement) =>
      !element.matches(':disabled, [aria-disabled="true"], [inert]') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
    const actions = Array.from(
      ref.querySelectorAll<HTMLElement>(
        '[data-dialog-primary-action], [data-slot="dialog-footer"] button, [data-slot="dialog-footer"] a[href]',
      ),
    ).filter(belongsToDialog);
    // Standard dialog footers put the primary action last. Non-footer actions
    // (such as Create workspace) can declare themselves explicitly.
    const primary =
      actions.find((action) => action.hasAttribute('data-dialog-primary-action')) ?? actions.at(-1);
    const field = Array.from(
      ref.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
      ),
    ).find((element) => belongsToDialog(element) && canFocus(element));
    const target = primary && canFocus(primary) ? primary : (field ?? ref);
    event.preventDefault();
    target.focus({ preventScroll: true });
  }

  function preventAutoFocus(
    event: Parameters<NonNullable<DialogPrimitive.ContentProps['onOpenAutoFocus']>>[0],
  ) {
    event.preventDefault();
  }
</script>

{#snippet dialogContent()}
  <DialogOverlay contained={Boolean(container)} staticPosition={staticPosition()} />
  <DialogPrimitive.Content
    bind:ref
    forceMount
    {...restProps}
    onInteractOutside={handleInteractOutside}
    onOpenAutoFocus={staticPosition() ? preventAutoFocus : handleOpenAutoFocus}
    onCloseAutoFocus={staticPosition() ? preventAutoFocus : onCloseAutoFocus}
    trapFocus={staticPosition() ? false : trapFocus}
    preventScroll={staticPosition() ? false : preventScroll}
  >
    {#snippet child({ props })}
      {#if open()}
        <div
          {...props}
          {role}
          data-slot="dialog-content"
          data-overlay-surface
          data-size={size}
          data-static-position={staticPosition() || undefined}
          class={cn(
            staticPosition() ? 'relative mx-auto' : container ? 'absolute' : 'fixed',
            !staticPosition() && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'dialog-editorial-content overlay-surface z-[var(--layer-modal)] grid w-full overflow-y-auto overscroll-contain p-6 text-popover-foreground outline-none motion-reduce:animate-none motion-reduce:transition-none',
            size === 'sm' && (density === 'compact' ? 'max-w-90' : 'max-w-100'),
            size === 'default' && 'max-w-110',
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
                  class="dialog-close-button absolute right-6 -translate-y-1/2 text-muted-foreground"
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
{/snippet}

{#if presence.mounted}
  {#if staticPosition()}
    {@render dialogContent()}
  {:else}
    <DialogPrimitive.Portal {...portalProps} to={container ?? portalProps?.to}>
      {@render dialogContent()}
    </DialogPrimitive.Portal>
  {/if}
{/if}

<style>
  :global(.dialog-editorial-content) {
    --dialog-content-min-width: 26.25rem;
    anchor-scope: --dialog-title;
    width: min(100% - 2rem, 100vw - 2rem);
    min-width: min(var(--dialog-content-min-width), 100% - 2rem, 100vw - 2rem);
    max-height: calc(100dvh - 2rem);
  }

  :global(.dialog-close-button) {
    top: calc(1.5rem + var(--text-title-line-height) / 2);
    /* Follow the title's first line, not a padding assumption or a wrapped title's center. */
    top: calc(anchor(--dialog-title top, 1.5rem) + var(--text-title-line-height) / 2);
  }

  :global(.dialog-editorial-content[data-size='sm']) {
    --dialog-content-min-width: 22.5rem;
  }

  :global(.dialog-editorial-content[data-size='lg']) {
    --dialog-content-min-width: 30rem;
  }
</style>

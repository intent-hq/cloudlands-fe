<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import DialogOverlay from './dialog-overlay.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    showCloseButton = true,
    closeDisabled = false,
    closeLabel = m.ui_dialog_close_ariaLabel(),
    children,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: DialogPrimitive.PortalProps;
    showCloseButton?: boolean;
    closeDisabled?: boolean;
    closeLabel?: string;
    children: Snippet;
  } = $props();
</script>

<DialogPrimitive.Portal {...portalProps}>
  <DialogOverlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'dialog-editorial-content data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-1/2 top-1/2 z-[var(--layer-modal)] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-4 text-popover-foreground outline-none motion-reduce:animate-none motion-reduce:transition-none',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        disabled={closeDisabled}
        class="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-[color,background-color,border-color] duration-[var(--motion-fast)] hover:bg-accent hover:text-accent-foreground focus-visible:border-input focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>

<style>
  :global(.dialog-editorial-content) {
    max-height: calc(100dvh - 2rem);
    box-shadow: var(--elevation-overlay);
    animation-duration: var(--motion-standard);
  }
</style>

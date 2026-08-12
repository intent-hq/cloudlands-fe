<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  export const sheetVariants = tv({
    base: 'sheet-editorial-content bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-[var(--layer-modal)] flex flex-col overflow-y-auto overscroll-contain border-border outline-none transition motion-reduce:animate-none motion-reduce:transition-none',
    variants: {
      side: {
        top: 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-2 top-0 rounded-b-md border-b border-x sm:inset-x-4',
        bottom:
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-2 bottom-0 rounded-t-md border-t border-x sm:inset-x-4',
        left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-2 left-0 rounded-r-md border-y border-r',
        right:
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-2 right-0 rounded-l-md border-y border-l',
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
  import SheetOverlay from './sheet-overlay.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';

  let {
    ref = $bindable(null),
    class: className,
    side = 'right',
    portalProps,
    showCloseButton = true,
    closeDisabled = false,
    closeLabel = m.ui_sheet_close_label(),
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
</script>

<SheetPrimitive.Portal {...portalProps}>
  <SheetOverlay />
  <SheetPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(sheetVariants({ side }), className)}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <SheetPrimitive.Close
        aria-label={closeLabel}
        disabled={closeDisabled}
        class="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-[color,background-color,border-color] duration-[var(--motion-fast)] hover:bg-accent hover:text-accent-foreground focus-visible:border-input focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </SheetPrimitive.Close>
    {/if}
  </SheetPrimitive.Content>
</SheetPrimitive.Portal>

<style>
  :global(.sheet-editorial-content) {
    box-shadow: var(--elevation-overlay);
    transition-duration: var(--motion-slow);
    transition-timing-function: var(--ease-standard);
  }

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

<script lang="ts">
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import { crispOut, springIn } from '$lib/motion';
  import { cn } from '$lib/utils.js';
  import { overlayMotion, useOverlayOpen } from '../dialog/overlay-motion.svelte';

  let {
    ref = $bindable(null),
    class: className,
    forceMount = false,
    ...restProps
  }: SheetPrimitive.OverlayProps = $props();

  const rootOpen = useOverlayOpen();
</script>

<SheetPrimitive.Overlay bind:ref forceMount {...restProps}>
  {#snippet child({ props })}
    {#if forceMount || rootOpen()}
      <div
        {...props}
        data-slot="sheet-overlay"
        class={cn(
          'fixed inset-0 z-[var(--layer-modal)] bg-black/40 dark:bg-black/80 motion-reduce:animate-none motion-reduce:transition-none',
          className,
        )}
        in:springIn={overlayMotion.backdrop.enter}
        out:crispOut={overlayMotion.backdrop.exit}
      ></div>
    {/if}
  {/snippet}
</SheetPrimitive.Overlay>

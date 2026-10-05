<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { crispOut, springIn } from '$lib/motion';
  import { cn } from '$lib/utils.js';
  import { overlayMotion, useOverlayOpen } from './overlay-motion.svelte';

  let {
    ref = $bindable(null),
    class: className,
    forceMount = false,
    contained = false,
    staticPosition = false,
    ...restProps
  }: DialogPrimitive.OverlayProps & { contained?: boolean; staticPosition?: boolean } = $props();

  const rootOpen = useOverlayOpen();
</script>

<DialogPrimitive.Overlay bind:ref forceMount {...restProps}>
  {#snippet child({ props })}
    {#if forceMount || rootOpen()}
      <div
        {...props}
        data-slot="dialog-overlay"
        data-static-position={staticPosition || undefined}
        class={cn(
          contained || staticPosition ? 'absolute' : 'fixed',
          'inset-0 z-[var(--layer-modal)] bg-black/40 dark:bg-black/80 motion-reduce:animate-none motion-reduce:transition-none',
          className,
        )}
        in:springIn={overlayMotion.backdrop.enter}
        out:crispOut={overlayMotion.backdrop.exit}
      ></div>
    {/if}
  {/snippet}
</DialogPrimitive.Overlay>

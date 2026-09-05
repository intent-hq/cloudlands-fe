<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { provideOverlayOpen } from './overlay-motion.svelte';

  let { open = $bindable(false), children, ...restProps }: DialogPrimitive.RootProps = $props();

  provideOverlayOpen(() => open);
</script>

<DialogPrimitive.Root bind:open {...restProps}>
  {@render children?.()}
</DialogPrimitive.Root>

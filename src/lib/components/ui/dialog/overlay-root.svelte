<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { provideOverlayOpen, provideOverlayStatic } from './overlay-motion.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    children,
    ...restProps
  }: DialogPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideOverlayOpen(() => open);
  provideOverlayStatic(() => staticPosition);
</script>

<DialogPrimitive.Root bind:open {...restProps}>
  {@render children?.()}
</DialogPrimitive.Root>

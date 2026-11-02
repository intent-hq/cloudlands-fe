<script lang="ts">
  import { setOwnedPopupClose } from '$lib/components/ui/owned-popup-context';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { provideOverlayOpen, provideOverlayStatic } from './overlay-motion.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    children,
    onOpenChange,
    ...restProps
  }: DialogPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideOverlayOpen(() => open);
  provideOverlayStatic(() => staticPosition);
  setOwnedPopupClose(() => {
    open = false;
    onOpenChange?.(false);
  });
</script>

<DialogPrimitive.Root bind:open {onOpenChange} {...restProps}>
  {@render children?.()}
</DialogPrimitive.Root>

<script lang="ts">
  import { setOwnedPopupClose } from '$lib/components/ui/owned-popup-context';
  import { Popover as PopoverPrimitive } from 'bits-ui';
  import { provideStaticOverlay } from '../static-overlay-context.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    children,
    onOpenChange,
    ...restProps
  }: PopoverPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideStaticOverlay(() => staticPosition);
  setOwnedPopupClose(() => {
    open = false;
    onOpenChange?.(false);
  });
</script>

<PopoverPrimitive.Root bind:open {onOpenChange} {...restProps}>
  {@render children?.()}
</PopoverPrimitive.Root>

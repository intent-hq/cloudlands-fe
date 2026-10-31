<script lang="ts">
  import { setOwnedPopupClose } from '$lib/components/ui/owned-popup-context';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { setContext } from 'svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { provideStaticOverlay } from '../static-overlay-context.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    onOpenChange,
    ...restProps
  }: MenuPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideStaticOverlay(() => staticPosition);
  setOwnedPopupClose(() => {
    open = false;
    onOpenChange?.(false);
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(() => {
      open = false;
      onOpenChange?.(false);
    });
  });

  setContext('canonical-menu', {
    get open() {
      return open;
    },
  });
</script>

<MenuPrimitive.Root bind:open {onOpenChange} {...restProps} />

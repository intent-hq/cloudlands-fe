<script lang="ts">
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

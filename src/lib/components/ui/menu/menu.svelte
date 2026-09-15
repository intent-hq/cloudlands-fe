<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { setContext } from 'svelte';
  import { provideStaticOverlay } from '../static-overlay-context.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    ...restProps
  }: MenuPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideStaticOverlay(() => staticPosition);

  setContext('canonical-menu', {
    get open() {
      return open;
    },
  });
</script>

<MenuPrimitive.Root bind:open {...restProps} />

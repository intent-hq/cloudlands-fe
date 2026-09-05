<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { setContext } from 'svelte';

  let { open = $bindable(false), ...restProps }: MenuPrimitive.RootProps = $props();

  setContext('canonical-menu', {
    get open() {
      return open;
    },
  });
</script>

<MenuPrimitive.Root bind:open {...restProps} />

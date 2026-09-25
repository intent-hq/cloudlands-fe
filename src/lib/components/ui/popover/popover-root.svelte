<script lang="ts">
  import { Popover as PopoverPrimitive } from 'bits-ui';
  import { provideStaticOverlay } from '../static-overlay-context.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    children,
    ...restProps
  }: PopoverPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideStaticOverlay(() => staticPosition);
</script>

<PopoverPrimitive.Root bind:open {...restProps}>
  {@render children?.()}
</PopoverPrimitive.Root>

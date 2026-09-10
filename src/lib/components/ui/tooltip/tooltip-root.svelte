<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { provideStaticOverlay } from '../static-overlay-context.svelte';

  let {
    open = $bindable(false),
    staticPosition = false,
    ...restProps
  }: TooltipPrimitive.RootProps & { staticPosition?: boolean } = $props();

  provideStaticOverlay(() => staticPosition);
</script>

<TooltipPrimitive.Root bind:open {...restProps} />

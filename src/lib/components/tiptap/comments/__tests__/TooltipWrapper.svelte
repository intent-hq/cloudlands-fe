<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  export let component: any;
  export let props: Record<string, any> = {};
</script>

<TooltipPrimitive.Provider>
  <svelte:component this={component} {...props} />
</TooltipPrimitive.Provider>

<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    child,
    children,
    ...restProps
  }: TooltipPrimitive.TriggerProps = $props();
</script>

<TooltipPrimitive.Trigger
  bind:ref
  data-slot="tooltip-trigger"
  {child}
  {children}
  class={cn(
    !child &&
      'type-caption inline-flex h-(--control-height-medium) items-center justify-center gap-1.5 rounded-(--radius-medium)',
    className,
  )}
  {...restProps}
/>

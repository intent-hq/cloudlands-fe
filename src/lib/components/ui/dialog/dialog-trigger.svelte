<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    child,
    ...restProps
  }: DialogPrimitive.TriggerProps = $props();
</script>

<DialogPrimitive.Trigger
  bind:ref
  data-slot="dialog-trigger"
  {child}
  class={cn(
    !child &&
      'type-caption inline-flex h-(--control-height-medium) items-center justify-center gap-1.5 rounded-(--radius-medium)',
    className,
  )}
  {...restProps}
/>

<script lang="ts">
  import { Label as LabelPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: LabelPrimitive.RootProps = $props();
</script>

<LabelPrimitive.Root
  bind:ref
  data-slot="label"
  class={cn(
    'type-body text-foreground flex min-w-0 select-none items-center gap-2 font-medium tracking-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-60 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60',
    className,
  )}
  {...restProps}
/>

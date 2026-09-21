<script lang="ts">
  import { Label as LabelPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';

  const contextSize = useSize();

  let {
    ref = $bindable(null),
    size,
    invalid = false,
    class: className,
    ...restProps
  }: LabelPrimitive.RootProps & { size?: UiSize; invalid?: boolean } = $props();

  const resolvedSize = $derived(size ?? contextSize);
</script>

<LabelPrimitive.Root
  bind:ref
  data-slot="label"
  data-size={resolvedSize}
  data-invalid={invalid || undefined}
  class={cn(
    'type-caption flex min-w-0 select-none items-center font-medium tracking-normal text-muted-foreground transition-[color] duration-(--spring-fast) group-hover:text-foreground group-focus-within:text-foreground data-[state=hover]:text-foreground data-[state=focus]:text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-60 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60 group-data-[invalid=true]:text-danger data-[invalid=true]:text-danger motion-reduce:transition-none',
    resolvedSize === 'compact' ? 'gap-1.5' : 'gap-2',
    className,
  )}
  {...restProps}
/>

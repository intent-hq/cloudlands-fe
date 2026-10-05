<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { Textarea } from '$lib/components/ui/textarea';
  import { cn } from '$lib/utils';

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: ComponentProps<typeof Textarea> = $props();

  export function focus() {
    ref?.focus();
  }

  export function blur() {
    ref?.blur();
  }
</script>

<Textarea
  {...restProps}
  bind:ref
  bind:value
  class={cn(
    className,
    'bg-card hover:bg-card data-[state=hover]:bg-card focus-visible:!bg-card disabled:bg-card disabled:hover:bg-card',
  )}
/>

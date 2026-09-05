<script lang="ts">
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value: string;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { value, disabled = false, class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Item {value} {disabled} class={cn('relative', className)} {...restProps as any}>
  {@render children?.()}
</AccordionPrimitive.Item>

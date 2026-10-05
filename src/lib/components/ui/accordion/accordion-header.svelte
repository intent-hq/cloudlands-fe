<script lang="ts">
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    level?: 1 | 2 | 3 | 4 | 5 | 6;
    class?: string;
    children?: Snippet;
  }

  let { level = 3, class: className, children, ...restProps }: Props = $props();
</script>

<AccordionPrimitive.Header {level} class={cn('flex', className)} {...restProps as any}>
  {@render children?.()}
</AccordionPrimitive.Header>

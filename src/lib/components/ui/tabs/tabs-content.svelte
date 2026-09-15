<script lang="ts">
  import { cn } from '$lib/utils';
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value: string;
    class?: string;
    children?: Snippet;
  }

  let { value, class: className, children, ...restProps }: Props = $props();
</script>

<TabsPrimitive.Content {value} class={cn('mt-3', className)} {...restProps as any}>
  {@render children?.()}
</TabsPrimitive.Content>

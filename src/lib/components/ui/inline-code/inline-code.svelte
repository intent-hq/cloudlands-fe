<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLElement> & { children?: Snippet } = $props();
</script>

<code
  data-slot="inline-code"
  class={cn(
    'type-body rounded-(--radius-small) bg-muted px-1 py-0.5 font-mono text-foreground',
    className,
  )}
  {...restProps}>{@render children?.()}</code
>

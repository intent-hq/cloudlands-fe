<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLOlAttributes } from 'svelte/elements';

  type Props = HTMLOlAttributes;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<ol
  class={cn(
    'type-body flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground sm:gap-2',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</ol>

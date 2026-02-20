<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLOlAttributes } from 'svelte/elements';

  type Props = HTMLOlAttributes;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<ol
  class={cn('flex items-center gap-1.5 text-sm text-muted-foreground sm:gap-2.5', className)}
  {...restProps}
>
  {@render children?.()}
</ol>

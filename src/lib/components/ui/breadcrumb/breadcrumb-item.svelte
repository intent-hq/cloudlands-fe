<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLLiAttributes } from 'svelte/elements';

  type Props = HTMLLiAttributes;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<li class={cn('inline-flex items-center gap-1.5', className)} {...restProps}>
  {@render children?.()}
</li>

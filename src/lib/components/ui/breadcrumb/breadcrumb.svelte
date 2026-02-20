<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLElement>;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<nav aria-label="breadcrumb" class={cn('', className)} {...restProps}>
  {@render children?.()}
</nav>

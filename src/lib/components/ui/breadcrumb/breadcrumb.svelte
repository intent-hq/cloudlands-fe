<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { m } from '$shared/paraglide/messages.js';

  type Props = HTMLAttributes<HTMLElement>;

  let { class: className, children, ...restProps }: Props = $props();
</script>

<nav aria-label={m.ui_breadcrumb_nav_ariaLabel()} class={cn('', className)} {...restProps}>
  {@render children?.()}
</nav>

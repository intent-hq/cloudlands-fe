<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLSpanElement>;

  let {
    class: className,
    role = 'link',
    'aria-disabled': ariaDisabled = true,
    'aria-current': ariaCurrent = 'page',
    children,
    ...restProps
  }: Props = $props();
</script>

<span
  {role}
  aria-disabled={ariaDisabled}
  aria-current={ariaCurrent}
  class={cn('font-normal text-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</span>

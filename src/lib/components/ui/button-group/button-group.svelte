<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import { buttonGroupVariants, type ButtonGroupVariant } from './button-group.variants';

  interface Props extends HTMLAttributes<HTMLDivElement>, ButtonGroupVariant {
    class?: string;
    children?: any;
  }

  let {
    class: className = '',
    orientation = 'horizontal',
    children,
    ...restProps
  }: Props = $props();

  const groupClass = $derived(
    cn(
      buttonGroupVariants({ orientation }),
      '[&_[data-slot=button]]:rounded-sm [&_[data-slot=button]]:border-border [&_[data-slot=button]]:shadow-none',
      '[&_[data-slot=button]:hover]:z-10 [&_[data-slot=button]:focus-visible]:z-20',
      '[&_[data-slot=button][data-state=active]]:z-10',
      className,
    ),
  );
</script>

<div
  role="group"
  data-slot="button-group"
  data-orientation={orientation}
  class={groupClass}
  {...restProps}
>
  {@render children?.()}
</div>

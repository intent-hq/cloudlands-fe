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
      '[&_[data-slot=button]]:rounded-sm [&_[data-slot=button]]:border-transparent',
      '[&_[data-slot=button-surface]]:rounded-[inherit]',
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

<style>
  /* Button roots use display:contents wrappers, so separators live on the control. */
  [data-slot='button-group'] > :global(:not(:last-child)) :global([data-slot='button'])::after {
    content: '';
    position: absolute;
    pointer-events: none;
    background: var(--color-border);
  }

  [data-orientation='horizontal']
    > :global(:not(:last-child))
    :global([data-slot='button'])::after {
    right: -1px;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 1px;
  }

  [data-orientation='vertical'] > :global(:not(:last-child)) :global([data-slot='button'])::after {
    bottom: -1px;
    left: 0.5rem;
    right: 0.5rem;
    height: 1px;
  }
</style>

<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
    title?: Snippet;
    description?: Snippet;
    icon?: Snippet;
    actions?: Snippet;
    children?: Snippet;
    class?: string;
    contentClass?: string;
  }

  let {
    title,
    description,
    icon,
    actions,
    children,
    class: className,
    contentClass,
    ...restProps
  }: Props = $props();
</script>

<section
  data-slot="empty-state"
  class={cn('flex min-h-48 items-center justify-center px-6 py-10 text-center', className)}
  {...restProps}
>
  <div class={cn('w-full max-w-md', contentClass)}>
    {#if icon}<div class="mx-auto mb-3 flex w-fit text-muted-foreground">{@render icon()}</div>{/if}
    {#if title}<div class="type-title font-semibold text-foreground">{@render title()}</div>{/if}
    {#if description}
      <div class="mt-1 type-body text-muted-foreground">{@render description()}</div>
    {/if}
    {#if actions}<div class="mt-4 flex justify-center gap-2">{@render actions()}</div>{/if}
    {@render children?.()}
  </div>
</section>

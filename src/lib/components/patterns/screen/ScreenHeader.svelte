<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
    title: Snippet;
    description?: Snippet;
    counter?: Snippet;
    leading?: Snippet;
    actions?: Snippet;
    class?: string;
  }

  let {
    title,
    description,
    counter,
    leading,
    actions,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<header
  data-slot="screen-header"
  class={cn('flex min-w-0 shrink-0 items-start gap-3 px-5 pt-5', className)}
  {...restProps}
>
  {#if leading}<div class="flex shrink-0 items-center">{@render leading()}</div>{/if}
  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      {#if counter}
        <div data-slot="screen-header-counter" class="shrink-0">{@render counter()}</div>
      {/if}
      <div data-slot="screen-header-title" class="min-w-0 flex-1">
        {@render title()}
      </div>
    </div>
    {#if description}
      <div data-slot="screen-header-description" class="mt-1 text-sm text-muted-foreground">
        {@render description()}
      </div>
    {/if}
  </div>
  {#if actions}<div data-slot="screen-header-actions" class="flex shrink-0 items-center gap-1">
      {@render actions()}
    </div>{/if}
</header>

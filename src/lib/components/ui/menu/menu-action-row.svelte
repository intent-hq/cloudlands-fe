<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

  type Props = Omit<HTMLButtonAttributes, 'title' | 'children'> & {
    leading?: Snippet;
    title: Snippet;
    description?: Snippet;
    trailing?: Snippet;
    selected?: boolean;
  };

  let {
    leading,
    title,
    description,
    trailing,
    selected = false,
    disabled = false,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<button
  type="button"
  {...restProps}
  {disabled}
  data-slot="menu-action-row"
  data-selected={selected ? '' : undefined}
  class={cn(
    menuItem(),
    'whitespace-normal text-foreground hover:bg-hover active:bg-active focus-visible:bg-hover focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
    selected && 'bg-selected hover:bg-selected focus-visible:bg-selected',
    className,
  )}
>
  {#if leading}
    <span data-slot="action-row-leading" class="flex size-4 shrink-0 items-center justify-center">
      {@render leading()}
    </span>
  {/if}
  <span data-slot="action-row-content" class="flex min-w-0 flex-1 flex-col gap-0.5">
    <span data-slot="action-row-title" class="min-w-0 break-words">{@render title()}</span>
    {#if description}
      <span data-slot="action-row-description" class="min-w-0 break-words text-muted-foreground">
        {@render description()}
      </span>
    {/if}
  </span>
  {#if trailing}
    <span data-slot="action-row-trailing" class="flex shrink-0 items-center gap-2">
      {@render trailing()}
    </span>
  {/if}
</button>

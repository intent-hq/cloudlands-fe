<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import { m } from '$shared/paraglide/messages.js';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    message?: string;
    children?: any;
  }

  let {
    class: className,
    message = m.ui_list_empty_label(),
    children,
    ...restProps
  }: Props = $props();
</script>

<div
  data-slot="list-empty"
  class={cn(
    'type-body flex min-h-28 items-center justify-center px-4 py-8 text-center text-muted-foreground',
    className,
  )}
  {...restProps}
>
  {#if children}
    {@render children()}
  {:else}
    <p>{message}</p>
  {/if}
</div>

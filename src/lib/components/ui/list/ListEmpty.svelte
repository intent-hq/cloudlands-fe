<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import Fa from 'svelte-fa';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    message?: string;
    icon?: any; // FontAwesome icon
    children?: any;
  }

  let { class: className, message = 'No items', icon, children, ...restProps }: Props = $props();
</script>

<div
  class={cn(
    'flex flex-col items-center justify-center py-8 px-4',
    'text-xs text-muted-foreground text-center',
    className,
  )}
  {...restProps}
>
  {#if icon}
    <div class="mb-2 opacity-50">
      <Fa {icon} size="20" />
    </div>
  {/if}

  {#if children}
    {@render children()}
  {:else}
    <p>{message}</p>
  {/if}
</div>

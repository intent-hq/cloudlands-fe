<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';

  import type { Snippet } from 'svelte';
  let {
    id = '',
    variant = 'default',
    class: className = '',
    children,
  }: {
    id?: string;
    variant?: 'default' | 'underline' | 'ghost' | 'secondary';
    class?: string;
    children?: Snippet;
  } = $props();

  const select = getContext<{ isOpen: boolean; triggerEl?: HTMLElement }>('select');

  let buttonEl: HTMLButtonElement | undefined = $state();

  // Store trigger element reference in context for portal positioning
  $effect(() => {
    if (buttonEl) {
      select.triggerEl = buttonEl;
    }
  });

  function toggleOpen(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    select.isOpen = !select.isOpen;
  }

  const variantClasses = {
    default: 'border border-input bg-background hover:bg-muted/50 px-3 py-2',
    underline:
      'border-0 bg-transparent underline underline-offset-3 decoration-muted-foreground/20 px-3 py-1 pt-0',
    ghost:
      'border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none hover:border-transparent  px-3 py-2',
    secondary: 'bg-background shadow-xs hover:bg-background/80 px-3 py-2',
  };
</script>

<button
  bind:this={buttonEl}
  {id}
  type="button"
  class={`flex items-center justify-between w-full text-sm rounded-md transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${variantClasses[variant]} ${className}`}
  onclick={toggleOpen}
>
  {@render children?.()}
  {#if variant === 'default'}
    <Fa icon={faChevronDown} size={10} class="opacity-50 ml-2" />
  {/if}
</button>

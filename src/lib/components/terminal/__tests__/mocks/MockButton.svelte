<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    onclick,
    type = 'button',
    disabled = false,
    class: className,
    title,
    tooltip,
    ...restProps
  }: {
    children?: Snippet;
    onclick?: (event: MouseEvent) => void;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    class?: string;
    title?: string;
    tooltip?: string;
  } = $props();
</script>

<button {type} {disabled} class={className} title={tooltip ?? title} {onclick} {...restProps}>
  {@render children?.()}
</button>
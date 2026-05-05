<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    children?: Snippet;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    [key: string]: unknown;
  };

  let props: Props = $props();
  const ariaLabel = $derived(props['aria-label'] as string | undefined);
</script>

<button type="button" disabled={props.disabled} onclick={props.onclick} aria-label={ariaLabel}>
  {@render props.children?.()}
</button>

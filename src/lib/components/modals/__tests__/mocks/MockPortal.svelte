<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    target?: string | HTMLElement;
    zIndex?: number;
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children()}


<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, trigger }: { children?: Snippet; trigger?: Snippet } = $props();
</script>

{@render trigger?.()}
{@render children?.()}

<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { setSurface } from '$lib/components/ui/surface-context';

  let { value, children }: { value: number; children: Snippet } = $props();
  setSurface(untrack(() => value));
</script>

{@render children()}

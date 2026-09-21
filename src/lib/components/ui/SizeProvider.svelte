<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte';
  import { SIZE_CONTEXT, type UiSize } from '$lib/components/ui/size-context';

  let { size = 'default', children }: { size?: UiSize; children: Snippet } = $props();

  setContext(
    SIZE_CONTEXT,
    untrack(() => size),
  );
</script>

{@render children()}

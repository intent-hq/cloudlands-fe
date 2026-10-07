<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Preview from './home.preview.svelte';

  let show = $state(true);
</script>

<Button onclick={() => (show = !show)}>Toggle Home</Button>
{#if show}
  <Preview />
{/if}

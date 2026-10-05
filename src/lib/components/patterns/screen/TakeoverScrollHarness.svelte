<script lang="ts">
  import TakeoverScreen from './TakeoverScreen.svelte';
  import { Button } from '$lib/components/ui/button';
  let { count = 40 }: { count?: number } = $props();
</script>

<div class="flex h-96">
  <TakeoverScreen>
    {#snippet title()}<h1>Scrollable takeover</h1>{/snippet}
    {#snippet primary()}<Button>Continue</Button>{/snippet}
    {#each Array.from({ length: count }, (_, index) => index) as index (index)}
      <div class="h-8" data-scroll-row>{index}</div>
    {/each}
  </TakeoverScreen>
</div>

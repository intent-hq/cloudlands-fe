<script lang="ts">
  import { onMount } from 'svelte';

  let { label, step }: { label: string; step: number } = $props();
  let count = $state(0);
  onMount(() => {
    window.dispatchEvent(new Event('ct-harness-mounted'));
    return () => window.dispatchEvent(new Event('ct-harness-unmounted'));
  });
</script>

<button onclick={() => (count += step)}>{label}: {count}</button>

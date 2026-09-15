<script lang="ts">
  import Drawer from '$lib/components/layout/Drawer.svelte';

  let { position = 'right' }: { kind?: 'drawer'; position?: 'left' | 'right' } = $props();

  let open = $state(false);
  let closeCount = $state(0);

  function handleClose() {
    closeCount += 1;
  }
</script>

<button data-testid="launcher" onclick={() => (open = true)}>Open legacy overlay</button>
<output data-testid="close-count">{closeCount}</output>

<Drawer bind:isOpen={open} title="Legacy drawer" {position} onclose={handleClose}>
  <input aria-label="Legacy drawer input" />
  <button>Nested drawer action</button>
</Drawer>

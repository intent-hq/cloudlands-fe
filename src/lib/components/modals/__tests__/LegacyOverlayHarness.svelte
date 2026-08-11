<script lang="ts">
  import Drawer from '$lib/components/layout/Drawer.svelte';
  import Modal from '../Modal.svelte';

  let { kind, position = 'right' }: { kind: 'modal' | 'drawer'; position?: 'left' | 'right' } =
    $props();

  let open = $state(false);
  let closeCount = $state(0);

  function handleClose() {
    closeCount += 1;
  }
</script>

<button data-testid="launcher" onclick={() => (open = true)}>Open legacy overlay</button>
<output data-testid="close-count">{closeCount}</output>

{#if kind === 'modal'}
  <Modal bind:open title="Legacy modal" onClose={handleClose}>
    <input aria-label="Legacy modal input" />
    <button>Nested modal action</button>
  </Modal>
{:else}
  <Drawer bind:isOpen={open} title="Legacy drawer" {position} onclose={handleClose}>
    <input aria-label="Legacy drawer input" />
    <button>Nested drawer action</button>
  </Drawer>
{/if}

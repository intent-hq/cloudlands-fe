<script lang="ts">
  import * as Dialog from './index';

  let {
    closeDisabled = false,
    longContent = false,
  }: { closeDisabled?: boolean; longContent?: boolean } = $props();
  let open = $state(false);
  let destructiveCount = $state(0);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>Open dialog</Dialog.Trigger>
  <Dialog.Content {closeDisabled}>
    <Dialog.Header>
      <Dialog.Title>Canonical dialog</Dialog.Title>
      <Dialog.Description>Dialog behavior fixture</Dialog.Description>
    </Dialog.Header>
    <input aria-label="Dialog field" />
    <button>Nested dialog action</button>
    {#if longContent}
      <div data-testid="dialog-long-content">
        {#each Array.from({ length: 24 }) as _, index (index)}
          <p>Long dialog content row {index + 1}</p>
        {/each}
      </div>
    {/if}
    <Dialog.Footer>
      <button class="text-danger" onclick={() => (destructiveCount += 1)}>Delete item</button>
    </Dialog.Footer>
    <output aria-label="Dialog destructive count">{destructiveCount}</output>
  </Dialog.Content>
</Dialog.Root>

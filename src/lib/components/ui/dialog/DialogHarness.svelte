<script lang="ts">
  import * as Dialog from './index';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';

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
    <Input aria-label="Dialog field" />
    <Button variant="ghost">Nested dialog action</Button>
    {#if longContent}
      <div data-testid="dialog-long-content">
        {#each Array.from({ length: 24 }) as _, index (index)}
          <p>Long dialog content row {index + 1}</p>
        {/each}
      </div>
    {/if}
    <Dialog.Footer>
      <Button variant="destructive" onclick={() => (destructiveCount += 1)}>Delete item</Button>
    </Dialog.Footer>
    <output aria-label="Dialog destructive count">{destructiveCount}</output>
  </Dialog.Content>
</Dialog.Root>

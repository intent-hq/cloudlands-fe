<script lang="ts">
  import * as Sheet from './index';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';

  let {
    closeDisabled = false,
    longContent = false,
  }: { closeDisabled?: boolean; longContent?: boolean } = $props();
  let open = $state(false);
  let destructiveCount = $state(0);
</script>

<Sheet.Root bind:open>
  <Sheet.Trigger>Open sheet</Sheet.Trigger>
  <Sheet.Content {closeDisabled}>
    <Sheet.Header>
      <Sheet.Title>Canonical sheet</Sheet.Title>
      <Sheet.Description>Sheet behavior fixture</Sheet.Description>
    </Sheet.Header>
    <Input aria-label="Sheet field" />
    <Button variant="ghost">Nested sheet action</Button>
    {#if longContent}
      <div data-testid="sheet-long-content">
        {#each Array.from({ length: 24 }) as _, index (index)}
          <p>Long sheet content row {index + 1}</p>
        {/each}
      </div>
    {/if}
    <Sheet.Footer>
      <Button variant="destructive" onclick={() => (destructiveCount += 1)}>Delete item</Button>
    </Sheet.Footer>
    <output aria-label="Sheet destructive count">{destructiveCount}</output>
  </Sheet.Content>
</Sheet.Root>

<script lang="ts">
  import * as Sheet from './index';

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
    <input aria-label="Sheet field" />
    <button>Nested sheet action</button>
    {#if longContent}
      <div data-testid="sheet-long-content">
        {#each Array.from({ length: 24 }) as _, index (index)}
          <p>Long sheet content row {index + 1}</p>
        {/each}
      </div>
    {/if}
    <Sheet.Footer>
      <button class="text-danger" onclick={() => (destructiveCount += 1)}>Delete item</button>
    </Sheet.Footer>
    <output aria-label="Sheet destructive count">{destructiveCount}</output>
  </Sheet.Content>
</Sheet.Root>

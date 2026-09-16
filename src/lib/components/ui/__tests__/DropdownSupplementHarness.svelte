<script lang="ts">
  import { Dropdown } from '$lib/components/ui/dropdown';
  import { Button } from '$lib/components/ui/button';
  let { portal = false }: { portal?: boolean } = $props();
  let value = $state('alpha');
  let changes = $state(0);
  let actions = $state(0);
  let slotActions = $state({ header: 0, footer: 0 });
</script>

<Dropdown
  bind:value
  {portal}
  animate={false}
  options={[
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
  ]}
  onchange={() => (changes += 1)}
>
  {#snippet header()}
    <Button onclick={() => (slotActions.header += 1)}>Header action</Button>
  {/snippet}
  {#snippet footer()}
    <Button onclick={() => (slotActions.footer += 1)}>Footer action</Button>
  {/snippet}
  {#snippet itemAfter({ selected })}
    {#if selected}
      <Button onclick={() => (actions += 1)}>Configure option</Button>
    {/if}
  {/snippet}
</Dropdown>
<output data-testid="supplement-result">{JSON.stringify({ value, changes, actions })}</output>
<output data-testid="slot-actions">{JSON.stringify(slotActions)}</output>

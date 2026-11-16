<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import Combobox from './combobox.svelte';

  let open = $state(false);
  let filter = $state('all');
  const options = [
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
  ];
</script>

<Popover.Root bind:open>
  <Popover.Trigger>Choose person</Popover.Trigger>
  <Popover.Content aria-label="Person picker" role="dialog" class="w-80 p-2">
    <button type="button" onclick={() => (filter = filter === 'all' ? 'pioneers' : 'all')}
      >Filter</button
    >
    <Combobox
      staticPosition
      {options}
      ariaLabel="Person"
      onopenchange={(next) => {
        if (!next) open = false;
      }}
    />
  </Popover.Content>
</Popover.Root>
<output data-testid="embedded-filter">{filter}</output>

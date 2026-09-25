<script lang="ts">
  import Combobox from './combobox.svelte';
  import type { ComboboxGroup, ComboboxOption } from './types';

  let {
    value = $bindable<string | string[]>('grace'),
    multiple = false,
    settled = false,
  }: { value?: string | string[]; multiple?: boolean; settled?: boolean } = $props();

  let settleSearch = $state<(() => void) | null>(null);
  let changes = $state(0);
  let commits = $state(0);
  let acceptedOption = $state<ComboboxOption | null>(null);
  const options = [
    { value: 'ada', label: 'Ada Lovelace', data: 'cached' },
    { value: 'grace', label: 'Grace Hopper', data: 'cached' },
  ];

  function search() {
    return new Promise<ComboboxGroup[]>((resolve) => {
      settleSearch = () =>
        resolve([
          {
            key: 'options',
            label: '',
            options: [{ value: 'ada', label: 'Ada Lovelace', data: 'settled' }],
          },
        ]);
    });
  }

  $effect(() => {
    if (settled) settleSearch?.();
  });
</script>

<Combobox
  bind:value
  {multiple}
  {options}
  ariaLabel="People"
  onsearch={search}
  onchange={() => (changes += 1)}
  oncommit={(_, option) => {
    commits += 1;
    acceptedOption = option;
  }}
/>
<output aria-label="Selected people">{JSON.stringify(value)}</output>
<output aria-label="People changes">{changes}</output>
<output aria-label="People commits">{commits}</output>
<output aria-label="Accepted person">{JSON.stringify(acceptedOption)}</output>

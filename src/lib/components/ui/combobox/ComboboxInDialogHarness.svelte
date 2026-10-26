<script lang="ts">
  import { FormDialog } from '$lib/components/patterns/confirm';
  import Combobox from './combobox.svelte';
  import SearchableSelect from '../searchable-select/searchable-select.svelte';
  import SearchableCombobox from '../searchable-combobox/searchable-combobox.svelte';
  import GroupedCombobox from '../grouped-combobox/grouped-combobox.svelte';

  let {
    variant = 'combobox',
    fillerRem = 0,
    trailingRem = 0,
    portal,
    inDialog = true,
  }: {
    variant?: 'combobox' | 'searchable-select' | 'searchable-combobox' | 'grouped-combobox';
    fillerRem?: number;
    trailingRem?: number;
    portal?: boolean;
    inDialog?: boolean;
  } = $props();
  let value = $state('ada');
  const options = [
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
    { value: 'linus', label: 'Linus Torvalds' },
    { value: 'margaret', label: 'Margaret Hamilton' },
  ];
  const groups = [
    { key: 'pioneers', label: 'Pioneers', options: options.slice(0, 2) },
    { key: 'builders', label: 'Builders', options: options.slice(2) },
  ];
  const onChange = (next: string) => (value = next);
</script>

{#snippet field()}
  {#if fillerRem > 0}
    <div style="height: {fillerRem}rem" data-testid="filler"></div>
  {/if}
  {#if variant === 'combobox'}
    <Combobox
      ariaLabel="Person"
      {options}
      {portal}
      {value}
      onchange={(next) => typeof next === 'string' && onChange(next)}
    />
  {:else if variant === 'searchable-select'}
    <SearchableSelect ariaLabel="Person" {options} {value} {onChange} />
  {:else if variant === 'searchable-combobox'}
    <SearchableCombobox ariaLabel="Person" {options} {value} {onChange} />
  {:else}
    <GroupedCombobox ariaLabel="Person" {groups} {value} {onChange} defaultCollapsed={false} />
  {/if}
  {#if trailingRem > 0}
    <div style="height: {trailingRem}rem" data-testid="trailing"></div>
  {/if}
{/snippet}

{#if inDialog}
  <FormDialog
    open
    title="Assign reviewer"
    submitLabel="Save"
    cancelLabel="Cancel"
    onSubmit={() => {}}
    onCancel={() => {}}
  >
    {@render field()}
  </FormDialog>
{:else}
  <div data-testid="page-host">{@render field()}</div>
{/if}
<output data-testid="combobox-in-dialog-value">{value}</output>

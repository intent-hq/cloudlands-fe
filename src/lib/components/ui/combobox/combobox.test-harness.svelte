<script lang="ts">
  import Combobox from './combobox.svelte';
  import type { ComboboxOption } from './types';

  interface Props {
    value?: string | string[];
    multiple?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    loading?: boolean;
    portal?: boolean;
    options?: ComboboxOption[];
  }

  let {
    value = $bindable<string | string[]>(''),
    multiple = false,
    disabled = false,
    invalid = false,
    loading = false,
    portal = false,
    options = [
      { value: 'ada', label: 'Ada Lovelace' },
      { value: 'grace', label: 'Grace Hopper' },
      { value: 'disabled', label: 'Disabled person', disabled: true },
      {
        value: 'long',
        label: 'A very long option label that should remain readable and truncate safely',
      },
    ],
  }: Props = $props();
</script>

{#if multiple}
  <Combobox
    bind:value
    {options}
    multiple
    {disabled}
    {invalid}
    {loading}
    {portal}
    ariaLabel="Search people"
    placeholder="Select people"
    searchPlaceholder="Search people"
  />
  <output data-testid="combobox-value">{JSON.stringify(value)}</output>
{:else}
  <Combobox
    bind:value
    {options}
    {disabled}
    {invalid}
    {loading}
    {portal}
    ariaLabel="Search people"
    placeholder="Select people"
    searchPlaceholder="Search people"
  />
  <output data-testid="combobox-value">{JSON.stringify(value)}</output>
{/if}

<script lang="ts">
  import { Select } from './index';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    disabled?: boolean;
    invalid?: boolean;
    portal?: boolean;
    consumerId?: string;
    unlabelled?: boolean;
    searchable?: boolean;
    staticPosition?: boolean;
    value?: string;
    items?: { value: string; label: string; disabled?: boolean }[];
    labelledby?: string;
    describedby?: string;
    onchange?: (value: string) => void;
  }

  let {
    disabled = false,
    invalid = false,
    portal = false,
    consumerId,
    unlabelled = false,
    searchable = false,
    staticPosition = false,
    value = $bindable('apple'),
    items = [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
      { value: 'cherry', label: 'A very long cherry option label used to verify truncation' },
    ],
    labelledby,
    describedby,
    onchange,
  }: Props = $props();
  let open = $state(false);
</script>

{#if searchable}
  <Button>Outside action</Button>
{/if}
{#if consumerId}
  <label for={consumerId}>Fruit</label>
{/if}
{#if labelledby}<span id={labelledby}>Favorite fruit</span>{/if}
{#if describedby}<span id={describedby}>Choose a snack for today.</span>{/if}
<Select.Root bind:value bind:open {items} {disabled} {invalid} {staticPosition} {onchange}>
  <Select.Trigger
    id={consumerId}
    aria-label={consumerId || unlabelled || labelledby ? undefined : 'Choose fruit'}
    aria-labelledby={labelledby}
    aria-describedby={describedby}
  >
    <Select.Value placeholder="Choose fruit" />
  </Select.Trigger>
  <Select.Content {portal}>
    {#if searchable}
      <Input aria-label="Filter fruit" />
    {/if}
    {#each items as option}
      <Select.Item value={option.value} label={option.label} disabled={option.disabled}
        >{option.label}</Select.Item
      >
    {/each}
  </Select.Content>
</Select.Root>

<output data-testid="select-value">{value}</output>
<output data-testid="select-open">{open}</output>

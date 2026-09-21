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
  }

  let {
    disabled = false,
    invalid = false,
    portal = false,
    consumerId,
    unlabelled = false,
    searchable = false,
    staticPosition = false,
  }: Props = $props();
  let value = $state('apple');
  let open = $state(false);

  const items = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'A very long cherry option label used to verify truncation' },
  ];
</script>

{#if searchable}
  <Button>Outside action</Button>
{/if}
{#if consumerId}
  <label for={consumerId}>Fruit</label>
{/if}
<Select.Root bind:value bind:open {items} {disabled} {invalid} {staticPosition}>
  <Select.Trigger
    id={consumerId}
    aria-label={consumerId || unlabelled ? undefined : 'Choose fruit'}
  >
    <Select.Value placeholder="Choose fruit" />
  </Select.Trigger>
  <Select.Content {portal}>
    {#if searchable}
      <Input aria-label="Filter fruit" />
    {/if}
    {#each items as option}
      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>

<output data-testid="select-value">{value}</output>
<output data-testid="select-open">{open}</output>

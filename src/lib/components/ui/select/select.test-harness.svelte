<script lang="ts">
  import { Select } from './index';

  interface Props {
    disabled?: boolean;
    invalid?: boolean;
    portal?: boolean;
  }

  let { disabled = false, invalid = false, portal = false }: Props = $props();
  let value = $state('apple');
  let open = $state(false);

  const items = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'A very long cherry option label used to verify truncation' },
  ];
</script>

<Select.Root bind:value bind:open {items} {disabled} {invalid}>
  <Select.Trigger aria-label="Choose fruit">
    <Select.Value placeholder="Choose fruit" />
  </Select.Trigger>
  <Select.Content {portal}>
    {#each items as option}
      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>

<output data-testid="select-value">{value}</output>
<output data-testid="select-open">{open}</output>

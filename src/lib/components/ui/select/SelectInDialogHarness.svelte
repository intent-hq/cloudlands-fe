<script lang="ts">
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Select } from './index';

  let { fillerRem = 0 }: { fillerRem?: number } = $props();
  let value = $state('value');
  const items = [
    { value: 'value', label: 'Value' },
    { value: 'empty', label: 'Empty' },
    { value: 'unset', label: 'Unset' },
  ];
</script>

<FormDialog
  open
  title="Edit profile"
  submitLabel="Save"
  cancelLabel="Cancel"
  onSubmit={() => {}}
  onCancel={() => {}}
>
  {#if fillerRem > 0}
    <div style="height: {fillerRem}rem" data-testid="filler"></div>
  {/if}
  <Select.Root bind:value {items}>
    <Select.Trigger aria-label="Mode"><Select.Value /></Select.Trigger>
    <Select.Content>
      {#each items as item (item.value)}
        <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</FormDialog>
<output data-testid="select-in-dialog-value">{value}</output>

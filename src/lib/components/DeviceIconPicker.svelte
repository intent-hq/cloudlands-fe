<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { Select } from '$lib/components/ui/select';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import type { DeviceIconChoice } from '$shared/types/connections';
  import { m } from '$shared/paraglide/messages.js';
  import {
    deviceIconOptions,
    type DeviceIconSource,
    type DeviceIconOption,
  } from '$lib/utils/device-icons';

  interface Props {
    record: DeviceIconSource;
    value?: DeviceIconChoice;
    disabled?: boolean;
    portal?: boolean;
    class?: string;
    onchange?: (value: DeviceIconChoice) => void;
  }

  let {
    record,
    value = $bindable(),
    disabled = false,
    portal = false,
    class: className = '',
    onchange,
  }: Props = $props();

  const options = $derived(deviceIconOptions(record));
  const selected = $derived(value ?? record.deviceIcon ?? 'auto');
  const selectItems = $derived(
    options.map(({ value: optionValue, label }) => ({ value: optionValue, label })),
  );
  const selectedOption = $derived(
    options.find((option) => option.value === selected) ?? options[0],
  );
  const selectedRecord = $derived({ ...record, deviceIcon: selected });
  const deviceOptions = $derived(options.filter((option) => option.group === 'devices'));
  const wildCardOptions = $derived(options.filter((option) => option.group === 'wildCards'));

  function choose(nextValue: string) {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option) return;
    value = option.value;
    onchange?.(option.value);
  }
</script>

{#snippet optionRow(option: DeviceIconOption)}
  <span class="flex min-w-0 items-center gap-2">
    <DeviceIcon record={{ deviceIcon: option.kind }} />
    <span class="truncate">{option.label}</span>
  </span>
{/snippet}

<div class={className} data-testid="device-icon-picker">
  <Select.Root value={selected} items={selectItems} {disabled} onchange={choose}>
    <Select.Trigger
      aria-label={m.deviceIcons_picker_trigger_ariaLabel({ selection: selectedOption.label })}
      data-testid="device-icon-picker-trigger"
    >
      <span class="flex min-w-0 items-center gap-2">
        <DeviceIcon record={selectedRecord} />
        <span class="truncate">{selectedOption.label}</span>
      </span>
    </Select.Trigger>
    <Select.Content {portal}>
      <Select.Item value="auto" label={options[0].label}
        >{@render optionRow(options[0])}</Select.Item
      >
      <SelectPrimitive.Group>
        <SelectPrimitive.GroupHeading class="px-2 pb-1 pt-2 type-caption text-muted-foreground">
          {m.deviceIcons_group_devices_label()}
        </SelectPrimitive.GroupHeading>
        {#each deviceOptions as option (option.value)}
          <Select.Item value={option.value} label={option.label}
            >{@render optionRow(option)}</Select.Item
          >
        {/each}
      </SelectPrimitive.Group>
      <SelectPrimitive.Group>
        <SelectPrimitive.GroupHeading class="px-2 pb-1 pt-2 type-caption text-muted-foreground">
          {m.deviceIcons_group_wildCards_label()}
        </SelectPrimitive.GroupHeading>
        {#each wildCardOptions as option (option.value)}
          <Select.Item value={option.value} label={option.label}
            >{@render optionRow(option)}</Select.Item
          >
        {/each}
      </SelectPrimitive.Group>
    </Select.Content>
  </Select.Root>
</div>

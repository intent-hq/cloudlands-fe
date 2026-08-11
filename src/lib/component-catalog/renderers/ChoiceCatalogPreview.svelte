<script lang="ts">
  import { Combobox, type ComboboxGroup, type ComboboxOption } from '$lib/components/ui/combobox';
  import { Select } from '$lib/components/ui/select';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let comboboxValue = $state<string | string[]>('grace');
  let openComboboxValue = $state<string | string[]>('grace');
  let openCombobox = $state(true);
  let multiComboboxValue = $state<string | string[]>(['ada', 'grace']);
  let longComboboxOpen = $state(true);
  let selectValue = $state('apple');
  let openSelectValue = $state('apple');
  let openSelect = $state(true);
  let longSelectValue = $state('option-01');
  let longSelectOpen = $state(true);
  const options: ComboboxOption[] = [
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
    { value: 'long', label: 'A very long option label that remains readable in compact layouts' },
  ];
  const groups: ComboboxGroup[] = [{ key: 'people', label: 'People', options }];
  const selectItems = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'long', label: 'A very long select option for compact layout verification' },
  ];
  const longOptions: ComboboxOption[] = Array.from({ length: 18 }, (_, index) => ({
    value: `option-${String(index + 1).padStart(2, '0')}`,
    label: `Catalog option ${String(index + 1).padStart(2, '0')}`,
  }));
  const longSelectItems = longOptions.map(({ value, label }) => ({ value, label }));
</script>

<div class="grid w-full min-w-0 max-w-md gap-4" data-catalog-renderer-fixture={fixture.id}>
  {#if componentId === 'combobox'}
    {#if fixture.id === 'combobox-state-matrix'}
      <div data-catalog-rendered-state="closed selected">
        <Combobox
          bind:value={comboboxValue}
          {options}
          portal={false}
          ariaLabel="Catalog combobox"
        />
        <output class="sr-only" aria-label="Combobox value">{JSON.stringify(comboboxValue)}</output>
      </div>
      <div class="pb-32" data-catalog-state="combobox-open" data-catalog-rendered-state="open">
        <Combobox
          bind:value={openComboboxValue}
          bind:open={openCombobox}
          {options}
          portal={false}
          ariaLabel="Open catalog combobox"
        />
      </div>
      <div data-catalog-state="combobox-multi" data-catalog-rendered-state="multi-selected">
        <Combobox
          bind:value={multiComboboxValue}
          {options}
          multiple
          portal={false}
          ariaLabel="Multi-select catalog combobox"
        />
        <output class="sr-only" aria-label="Multi-select combobox value"
          >{JSON.stringify(multiComboboxValue)}</output
        >
      </div>
      <div class="grid gap-2" data-catalog-rendered-state="compact-28 medium-32 large-36">
        <Combobox
          value="ada"
          {options}
          portal={false}
          ariaLabel="Compact catalog combobox"
          inputClass="h-(--control-height-small)"
        />
        <Combobox
          value="grace"
          {options}
          portal={false}
          ariaLabel="Medium catalog combobox"
          inputClass="h-(--control-height-medium)"
        />
        <Combobox
          value="long"
          {options}
          portal={false}
          ariaLabel="Large catalog combobox"
          inputClass="h-(--control-height-large)"
        />
      </div>
      <div data-catalog-rendered-state="disabled">
        <Combobox {options} disabled portal={false} ariaLabel="Disabled combobox" />
      </div>
      <div data-catalog-rendered-state="invalid">
        <Combobox {options} invalid portal={false} ariaLabel="Invalid combobox" />
      </div>
      <div data-catalog-rendered-state="loading">
        <Combobox {options} loading portal={false} ariaLabel="Loading combobox" />
      </div>
    {:else}
      <div data-catalog-rendered-state="grouped long-content portal focus-restored reduced-motion">
        <Combobox
          bind:value={comboboxValue}
          {groups}
          portal={false}
          ariaLabel="Grouped catalog combobox"
        />
      </div>
      <div data-catalog-rendered-state="empty">
        <Combobox
          options={[]}
          portal={false}
          ariaLabel="Empty combobox"
          emptyText="No matching people"
        />
      </div>
      <div
        data-catalog-state="combobox-long-list"
        data-catalog-rendered-state="long-list scrolling"
      >
        <Combobox
          value="option-01"
          bind:open={longComboboxOpen}
          options={longOptions}
          portal={false}
          ariaLabel="Long-list catalog combobox"
        />
      </div>
    {/if}
  {:else if componentId === 'select'}
    {#if fixture.id === 'select-state-matrix'}
      <div class="relative z-20" data-catalog-rendered-state="closed selected focus-visible">
        <Select.Root bind:value={selectValue} items={selectItems}>
          <Select.Trigger aria-label="Catalog select"
            ><Select.Value placeholder="Choose fruit" /></Select.Trigger
          >
          <Select.Content portal={false}
            >{#each selectItems as item}<Select.Item value={item.value} label={item.label}
                >{item.label}</Select.Item
              >{/each}</Select.Content
          >
        </Select.Root>
        <output class="sr-only" aria-label="Select value">{selectValue}</output>
      </div>
      <div
        class="relative z-10 pb-32"
        data-catalog-state="select-open"
        data-catalog-rendered-state="open"
      >
        <Select.Root bind:value={openSelectValue} bind:open={openSelect} items={selectItems}>
          <Select.Trigger aria-label="Open catalog select"><Select.Value /></Select.Trigger>
          <Select.Content portal={false}>
            {#each selectItems as item}
              <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="grid gap-2" data-catalog-rendered-state="compact-28 medium-32 large-36">
        <Select.Root value="apple" items={selectItems}>
          <Select.Trigger aria-label="Compact catalog select" class="h-(--control-height-small)">
            <Select.Value />
          </Select.Trigger>
        </Select.Root>
        <Select.Root value="banana" items={selectItems}>
          <Select.Trigger aria-label="Medium catalog select" class="h-(--control-height-medium)">
            <Select.Value />
          </Select.Trigger>
        </Select.Root>
        <Select.Root value="long" items={selectItems}>
          <Select.Trigger aria-label="Large catalog select" class="h-(--control-height-large)">
            <Select.Value />
          </Select.Trigger>
        </Select.Root>
      </div>
      <div data-catalog-rendered-state="disabled">
        <Select.Root value="apple" items={selectItems} disabled
          ><Select.Trigger aria-label="Disabled select"><Select.Value /></Select.Trigger
          ></Select.Root
        >
      </div>
      <div data-catalog-rendered-state="invalid">
        <Select.Root value="apple" items={selectItems} invalid
          ><Select.Trigger aria-label="Invalid select"><Select.Value /></Select.Trigger
          ></Select.Root
        >
      </div>
    {:else}
      <div data-catalog-rendered-state="long-content portal reduced-motion">
        <Select.Root value="long" items={selectItems}
          ><Select.Trigger aria-label="Long content select"><Select.Value /></Select.Trigger
          ><Select.Content portal={false}
            >{#each selectItems as item}<Select.Item value={item.value} label={item.label}
                >{item.label}</Select.Item
              >{/each}</Select.Content
          ></Select.Root
        >
      </div>
      <div data-catalog-rendered-state="empty">
        <Select.Root value="" items={[]}
          ><Select.Trigger aria-label="Empty select"
            ><Select.Value placeholder="No options" /></Select.Trigger
          ><Select.Content portal={false}></Select.Content></Select.Root
        >
      </div>
      <div data-catalog-state="select-long-list" data-catalog-rendered-state="long-list scrolling">
        <Select.Root
          bind:value={longSelectValue}
          bind:open={longSelectOpen}
          items={longSelectItems}
        >
          <Select.Trigger aria-label="Long-list catalog select"><Select.Value /></Select.Trigger>
          <Select.Content portal={false} wrapperClass="max-h-32 overflow-y-auto">
            {#each longSelectItems as item}
              <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}
  {/if}
</div>

<style>
  [data-catalog-renderer-fixture] > div {
    min-width: 0;
  }

  :global([data-catalog-state='combobox-long-list']:has([data-side='top'])) {
    padding-block-start: calc(var(--control-height-large) * 8 + var(--space-1));
  }

  :global([data-catalog-state='combobox-long-list']:has([data-side='bottom'])) {
    padding-block-end: calc(var(--control-height-large) * 8 + var(--space-1));
  }

  :global([data-catalog-state='select-long-list']:has([data-side='top'])) {
    padding-block-start: calc(var(--control-height-large) * 4 + var(--space-1));
  }

  :global([data-catalog-state='select-long-list']:has([data-side='bottom'])) {
    padding-block-end: calc(var(--control-height-large) * 4 + var(--space-1));
  }
</style>

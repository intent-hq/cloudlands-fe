<script lang="ts">
  import type { Snippet } from 'svelte';
  import SearchableSelect from '../searchable-select/searchable-select.svelte';
  import SearchableCombobox from '../searchable-combobox/searchable-combobox.svelte';
  import type { Option, ItemActionContext } from '../searchable-combobox/types';
  import GroupedCombobox from '../grouped-combobox/grouped-combobox.svelte';
  import type { GroupedOption, OptionGroup } from '../grouped-combobox/types';

  interface Props {
    mode: 'select' | 'searchable' | 'grouped';
    value?: string;
    selectSearch?: (query: string) => Promise<Option[]>;
    searchableSearch?: (query: string) => Promise<Option[]> | Option[];
    groupedSearch?: (query: string) => OptionGroup[];
    onChange?: (value: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onRename?: (option: Option, name: string) => void;
    onDelete?: (option: Option) => void;
    defaultCollapsed?: boolean;
    includeOptionDescription?: boolean;
  }

  let {
    mode,
    value = $bindable(''),
    selectSearch,
    searchableSearch,
    groupedSearch,
    onChange,
    onOpen,
    onClose,
    onRename,
    onDelete,
    defaultCollapsed = false,
    includeOptionDescription = true,
  }: Props = $props();

  const options: Option[] = [
    { value: 'ada', label: 'Ada Lovelace', description: 'Mathematician' },
    { value: 'grace', label: 'Grace Hopper', description: 'Admiral' },
  ];
  const groups: OptionGroup[] = [
    { key: 'people', label: 'People', options },
    { key: 'others', label: 'Others', options: [{ value: 'linus', label: 'Linus Torvalds' }] },
  ];
</script>

{#snippet optionDescription(option: Option | GroupedOption)}
  <span data-testid="option-description">Detail: {option.description}</span>
{/snippet}

{#snippet itemActions(context: ItemActionContext)}
  <button type="button" data-testid="rename-action" onclick={context.startRename}>Rename</button>
{/snippet}

{#snippet footer()}
  <span data-testid="legacy-footer">Footer action</span>
{/snippet}

{#snippet groupDescription(group: OptionGroup)}
  <span data-testid="group-description">{group.label} description</span>
{/snippet}

{#snippet groupAction(group: OptionGroup)}
  <span data-testid="group-action">{group.label} action</span>
{/snippet}

{#snippet headerAction()}
  <span data-testid="header-action">Header action</span>
{/snippet}

{#if mode === 'select'}
  <SearchableSelect
    bind:value
    {options}
    allowCustom
    onSearch={selectSearch}
    {onChange}
    loading={false}
    searchPlaceholder="Find a person"
  />
{:else if mode === 'searchable'}
  <SearchableCombobox
    bind:value
    {options}
    onSearch={searchableSearch}
    {onChange}
    {onOpen}
    {onClose}
    {onRename}
    {onDelete}
    triggerClass="legacy-trigger"
    header="People header"
    optionDescription={includeOptionDescription ? optionDescription : undefined}
    {itemActions}
    {footer}
    tooltip="People tooltip"
    tooltipSide="right"
    tooltipAlign="start"
    tooltipDelayDuration={0}
  />
{:else}
  <GroupedCombobox
    bind:value
    {groups}
    onSearch={groupedSearch}
    {onChange}
    {onOpen}
    {onClose}
    triggerClass="legacy-trigger"
    header="Grouped header"
    optionDescription={optionDescription as Snippet<[GroupedOption]>}
    {groupDescription}
    {groupAction}
    {headerAction}
    {footer}
    tooltip="Grouped tooltip"
    tooltipSide="left"
    {defaultCollapsed}
  />
{/if}

<output data-testid="legacy-value">{value}</output>

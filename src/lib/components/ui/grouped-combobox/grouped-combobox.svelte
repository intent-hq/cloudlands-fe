<script lang="ts">
  import type { Snippet } from 'svelte';
  import Combobox, { type ComboboxGroup, type ComboboxOption } from '../combobox';
  import Tooltip from '../tooltip/Tooltip.svelte';
  import type { GroupedOption, OptionGroup } from './types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    value?: string;
    groups?: OptionGroup[];
    placeholder?: string;
    disabled?: boolean;
    onSearch?: (query: string) => OptionGroup[];
    onChange?: (value: string, option?: GroupedOption, event?: MouseEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    class?: string;
    triggerClass?: string;
    dropdownClass?: string;
    header?: string;
    optionDescription?: Snippet<[GroupedOption]>;
    groupDescription?: Snippet<[OptionGroup]>;
    groupAction?: Snippet<[OptionGroup]>;
    headerAction?: Snippet;
    footer?: Snippet;
    tooltip?: string | Snippet;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    defaultCollapsed?: boolean;
  }

  let {
    value = $bindable(''),
    groups = [],
    placeholder = m.ui_groupedCombobox_select_placeholder(),
    disabled = false,
    onSearch,
    onChange,
    onOpen,
    onClose,
    class: className = '',
    triggerClass = '',
    dropdownClass = '',
    header = '',
    optionDescription,
    groupDescription,
    groupAction,
    headerAction,
    footer,
    tooltip,
    tooltipSide = 'top',
    defaultCollapsed = true,
  }: Props = $props();

  let searchQuery = $state('');
  let searchedGroups = $state<OptionGroup[] | null>(null);
  let collapsedGroups = $state<Set<string>>(new Set());
  let collapseInitialized = false;

  $effect(() => {
    if (!collapseInitialized && defaultCollapsed && groups.length > 0) {
      collapsedGroups = new Set(
        groups
          .filter((group) => !group.options.some((option) => option.value === value))
          .map((group) => group.key),
      );
      collapseInitialized = true;
    }
  });

  const canonicalGroups: ComboboxGroup[] = $derived(
    (searchedGroups ?? groups).map((group) => ({
      key: group.key,
      label: group.label,
      options:
        collapsedGroups.has(group.key) && !searchQuery
          ? []
          : group.options.map((option) => ({
              value: option.value,
              label: option.label,
              description: option.description,
              icon: option.icon,
              data: option.data,
            })),
      icon: group.icon,
      data: group.data,
    })),
  );

  function handleChange(nextValue: string | string[]) {
    if (typeof nextValue !== 'string') return;
    const option = groups
      .flatMap((group) => group.options)
      .find((item) => item.value === nextValue);
    onChange?.(nextValue, option);
  }

  function handleOpenChange(isOpen: boolean) {
    if (isOpen) onOpen?.();
    else onClose?.();
  }

  function handleQueryChange(query: string) {
    searchQuery = query;
    searchedGroups = query && onSearch ? onSearch(query) : null;
  }

  function toggleGroup(key: string) {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedGroups = next;
  }
</script>

{#snippet canonicalOptionDescription(option: ComboboxOption)}
  {@render optionDescription?.(option as GroupedOption)}
{/snippet}

{#snippet canonicalGroupDescription(group: ComboboxGroup)}
  {@render groupDescription?.(group as OptionGroup)}
{/snippet}

{#snippet canonicalGroupAction(group: ComboboxGroup)}
  <button
    type="button"
    aria-label={m.ui_groupedCombobox_toggleGroup_ariaLabel({ group: group.label })}
    onclick={() => toggleGroup(group.key)}
  >
    {collapsedGroups.has(group.key)
      ? m.ui_groupedCombobox_expandGroup_label()
      : m.ui_groupedCombobox_collapseGroup_label()}
  </button>
  {@render groupAction?.(group as OptionGroup)}
{/snippet}

{#snippet combobox()}
  <Combobox
    bind:value
    groups={canonicalGroups}
    {disabled}
    {placeholder}
    searchPlaceholder={placeholder}
    class={className}
    inputClass={triggerClass}
    contentClass={dropdownClass}
    ariaLabel={placeholder}
    portal={false}
    {header}
    {headerAction}
    {footer}
    optionDescription={optionDescription ? canonicalOptionDescription : undefined}
    groupDescription={groupDescription ? canonicalGroupDescription : undefined}
    groupAction={canonicalGroupAction}
    onquerychange={handleQueryChange}
    onchange={handleChange}
    onopenchange={handleOpenChange}
  />
{/snippet}

{#if tooltip}
  <Tooltip content={tooltip} side={tooltipSide}>
    {@render combobox()}
  </Tooltip>
{:else}
  {@render combobox()}
{/if}

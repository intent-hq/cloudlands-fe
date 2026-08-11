<script lang="ts">
  import type { Snippet } from 'svelte';
  import Combobox, { type ComboboxOption } from '../combobox';
  import Tooltip from '../tooltip/Tooltip.svelte';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { ItemActionContext, Option } from './types';

  interface Props {
    value?: string;
    options?: Option[];
    placeholder?: string;
    disabled?: boolean;
    triggerLabel?: string;
    onSearch?: (query: string) => Promise<Option[]> | Option[];
    onChange?: (value: string, option?: Option, event?: MouseEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onRename?: (option: Option, newName: string) => void;
    onDelete?: (option: Option) => void;
    class?: string;
    triggerClass?: string;
    dropdownClass?: string;
    inputClass?: string;
    header?: string;
    optionDescription?: Snippet<[Option]>;
    itemActions?: Snippet<[ItemActionContext]>;
    footer?: Snippet;
    tooltip?: string | Snippet;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
    dropdownPosition?: 'top' | 'bottom';
  }

  let {
    value = $bindable(''),
    options = [],
    placeholder = m.ui_searchableCombobox_select_placeholder(),
    disabled = false,
    triggerLabel,
    onSearch,
    onChange,
    onOpen,
    onClose,
    onRename,
    onDelete: _onDelete,
    class: className = '',
    triggerClass = '',
    dropdownClass = '',
    inputClass = '',
    header = '',
    optionDescription,
    itemActions,
    footer,
    tooltip,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipDelayDuration = 200,
    dropdownPosition = 'bottom',
  }: Props = $props();

  let renamingOptionValue = $state<string | null>(null);
  let renameValue = $state('');

  const canonicalOptions = $derived(
    options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
      disabled: option.data?.isSelectable === false,
    })),
  );

  function handleChange(nextValue: string | string[]) {
    if (typeof nextValue !== 'string') return;
    onChange?.(
      nextValue,
      options.find((option) => option.value === nextValue),
    );
  }

  function handleOpenChange(isOpen: boolean) {
    if (isOpen) onOpen?.();
    else onClose?.();
  }

  function itemActionContext(option: Option): ItemActionContext {
    return {
      option,
      isRenaming: renamingOptionValue === option.value,
      renameValue,
      startRename: () => {
        renamingOptionValue = option.value;
        renameValue = option.label;
      },
      cancelRename: () => {
        renamingOptionValue = null;
        renameValue = '';
      },
      commitRename: (newName: string) => {
        if (newName.trim() && newName.trim() !== option.label) onRename?.(option, newName.trim());
        renamingOptionValue = null;
        renameValue = '';
      },
    };
  }
</script>

{#snippet canonicalOptionDescription(option: ComboboxOption)}
  {#if renamingOptionValue === option.value}
    <input
      aria-label={`Rename ${option.label}`}
      bind:value={renameValue}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') itemActionContext(option as Option).commitRename(renameValue);
        else if (event.key === 'Escape') itemActionContext(option as Option).cancelRename();
      }}
      class="min-w-0 flex-1 border-b border-accent bg-transparent text-sm outline-none"
    />
  {:else}
    {@render optionDescription?.(option as Option)}
  {/if}
{/snippet}

{#snippet canonicalOptionActions(option: ComboboxOption)}
  {#if renamingOptionValue !== option.value}
    <span
      class="shrink-0"
      role="presentation"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      {@render itemActions?.(itemActionContext(option as Option))}
    </span>
  {/if}
{/snippet}

{#snippet combobox()}
  <Combobox
    bind:value
    options={canonicalOptions}
    {disabled}
    placeholder={triggerLabel ?? placeholder}
    displayValue={triggerLabel}
    searchPlaceholder={placeholder}
    class={className}
    inputClass={cn(inputClass, triggerClass)}
    contentClass={dropdownClass}
    side={dropdownPosition}
    ariaLabel={placeholder}
    portal={false}
    {header}
    optionDescription={optionDescription || itemActions ? canonicalOptionDescription : undefined}
    optionActions={itemActions ? canonicalOptionActions : undefined}
    {footer}
    onsearch={onSearch}
    onchange={handleChange}
    onopenchange={handleOpenChange}
  />
{/snippet}

{#if tooltip}
  <Tooltip
    content={tooltip}
    side={tooltipSide}
    align={tooltipAlign}
    delayDuration={tooltipDelayDuration}
  >
    {@render combobox()}
  </Tooltip>
{:else}
  {@render combobox()}
{/if}

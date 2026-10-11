// Source: ui/searchable-combobox/searchable-combobox.svelte.
import * as React from 'react';
import { m } from '$shared/paraglide/messages.js';
import { Combobox, type ComboboxProps } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ItemActionContext, Option } from './types';

export type { ItemActionContext, Option } from './types';
export type SearchableComboboxProps = Omit<
  ComboboxProps,
  | 'ariaLabel'
  | 'value'
  | 'defaultValue'
  | 'options'
  | 'groups'
  | 'multiple'
  | 'onSearch'
  | 'onChange'
  | 'optionDescription'
> & {
  ariaLabel?: string;
  value?: string;
  defaultValue?: string;
  options?: Option[];
  triggerLabel?: string;
  onSearch?: (query: string) => Option[] | Promise<Option[]>;
  onChange?: (value: string, option?: Option, event?: MouseEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRename?: (option: Option, newName: string) => void;
  /** Source compatibility: delete is provided by the caller's itemActions. */
  onDelete?: (option: Option) => void;
  triggerClass?: string;
  dropdownClass?: string;
  optionDescription?: (option: Option) => React.ReactNode;
  itemActions?: (context: ItemActionContext) => React.ReactNode;
  tooltip?: React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  tooltipAlign?: 'start' | 'center' | 'end';
  tooltipDelayDuration?: number;
  dropdownPosition?: 'top' | 'bottom';
};

const emptyOptions: Option[] = [];
function canonicalOption(option: Option): Option {
  const data = option.data;
  return {
    ...option,
    disabled:
      option.disabled ||
      (typeof data === 'object' &&
        data !== null &&
        'isSelectable' in data &&
        data.isSelectable === false),
  };
}

export function SearchableCombobox({
  options = emptyOptions,
  ariaLabel,
  placeholder = m.ui_searchableCombobox_select_placeholder(),
  triggerLabel,
  onSearch,
  onChange,
  onOpen,
  onClose,
  onOpenChange,
  onRename,
  onDelete: _onDelete,
  triggerClass,
  dropdownClass,
  inputClass,
  optionDescription,
  itemActions,
  tooltip,
  tooltipSide = 'top',
  tooltipAlign = 'center',
  tooltipDelayDuration = 200,
  dropdownPosition = 'bottom',
  ...props
}: SearchableComboboxProps) {
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const canonicalOptions = React.useMemo(() => options.map(canonicalOption), [options]);
  function context(option: Option): ItemActionContext {
    return {
      option,
      isRenaming: renaming === option.value,
      renameValue,
      startRename: () => {
        setRenaming(option.value);
        setRenameValue(option.label);
      },
      cancelRename: () => {
        setRenaming(null);
        setRenameValue('');
      },
      commitRename: (name) => {
        const trimmed = name.trim();
        if (trimmed && trimmed !== option.label) onRename?.(option, trimmed);
        setRenaming(null);
        setRenameValue('');
      },
    };
  }
  const picker = (
    <Combobox
      {...props}
      options={canonicalOptions}
      placeholder={triggerLabel ?? placeholder}
      displayValue={triggerLabel}
      searchPlaceholder={placeholder}
      inputClass={cn(inputClass, triggerClass)}
      contentClass={dropdownClass}
      side={dropdownPosition}
      ariaLabel={ariaLabel ?? placeholder}
      portal={false}
      onSearch={
        onSearch ? async (query) => (await onSearch(query)).map(canonicalOption) : undefined
      }
      onChange={(value, option) => {
        if (typeof value === 'string')
          onChange?.(value, option ?? options.find((item) => item.value === value));
      }}
      onOpenChange={(open) => {
        onOpenChange?.(open);
        if (open) onOpen?.();
        else onClose?.();
      }}
      optionDescription={
        optionDescription || itemActions
          ? (option) =>
              renaming === option.value ? (
                <Input
                  aria-label={m.ui_searchableCombobox_renameOption_ariaLabel({
                    name: option.label,
                  })}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  data-combobox-local-escape
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      context(option).commitRename(renameValue);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      context(option).cancelRename();
                    }
                  }}
                  className="min-w-0 flex-1 border-b border-accent bg-transparent text-sm outline-none"
                  noFocusStyle
                />
              ) : (
                optionDescription?.(option)
              )
          : undefined
      }
      optionActions={
        itemActions
          ? (option) =>
              renaming !== option.value && (
                <span
                  className="shrink-0"
                  role="presentation"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {itemActions(context(option))}
                </span>
              )
          : undefined
      }
    />
  );

  return tooltip ? (
    <Tooltip delayDuration={tooltipDelayDuration}>
      <TooltipTrigger asChild>
        <div className="w-full">{picker}</div>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} align={tooltipAlign}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  ) : (
    picker
  );
}

export default SearchableCombobox;

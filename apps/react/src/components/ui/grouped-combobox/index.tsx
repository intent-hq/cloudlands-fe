// Source: ui/grouped-combobox/grouped-combobox.svelte.
import * as React from 'react';
import { m } from '$shared/paraglide/messages.js';
import { Combobox, type ComboboxProps } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { TooltipRoot, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GroupedOption, OptionGroup } from './types';

export type { GroupedOption, OptionGroup } from './types';
export type GroupedComboboxProps = Omit<
  ComboboxProps,
  | 'ariaLabel'
  | 'value'
  | 'defaultValue'
  | 'options'
  | 'groups'
  | 'multiple'
  | 'onSearch'
  | 'onChange'
> & {
  ariaLabel?: string;
  value?: string;
  defaultValue?: string;
  groups?: OptionGroup[];
  onSearch?: (query: string) => OptionGroup[] | Promise<OptionGroup[]>;
  onChange?: (value: string, option?: GroupedOption, event?: MouseEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  triggerClass?: string;
  dropdownClass?: string;
  tooltip?: React.ReactNode;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  defaultCollapsed?: boolean;
};
const emptyGroups: OptionGroup[] = [];

export function GroupedCombobox({
  value,
  defaultValue = '',
  groups = emptyGroups,
  ariaLabel,
  placeholder = m.ui_groupedCombobox_select_placeholder(),
  onChange,
  onOpen,
  onClose,
  onOpenChange,
  onQueryChange,
  triggerClass,
  dropdownClass,
  groupAction,
  tooltip,
  tooltipSide = 'top',
  defaultCollapsed = true,
  staticPosition = false,
  ...props
}: GroupedComboboxProps) {
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const selected = value ?? localValue;
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const initialized = React.useRef(false);
  React.useLayoutEffect(() => {
    if (initialized.current || !defaultCollapsed || !groups.length) return;
    initialized.current = true;
    setCollapsed(
      new Set(
        groups
          .filter((group) => !group.options.some((option) => option.value === selected))
          .map((group) => group.key),
      ),
    );
  }, [defaultCollapsed, groups, selected]);
  const canonicalGroups = React.useMemo(
    () => groups.map((group) => ({ ...group, collapsed: collapsed.has(group.key) })),
    [groups, collapsed],
  );

  const picker = (
    <Combobox
      {...props}
      value={selected}
      groups={canonicalGroups}
      placeholder={placeholder}
      searchPlaceholder={placeholder}
      ariaLabel={ariaLabel ?? placeholder}
      inputClass={triggerClass}
      contentClass={dropdownClass}
      staticPosition={staticPosition}
      portal={!staticPosition}
      onChange={(next, option) => {
        if (typeof next !== 'string') return;
        setLocalValue(next);
        onChange?.(
          next,
          option ?? groups.flatMap((group) => group.options).find((item) => item.value === next),
        );
      }}
      onOpenChange={(open) => {
        onOpenChange?.(open);
        if (open) onOpen?.();
        else onClose?.();
      }}
      onQueryChange={(next) => {
        setQuery(next);
        onQueryChange?.(next);
      }}
      groupAction={(group) => (
        <>
          <Button
            variant="plain"
            type="button"
            data-list-overlay
            aria-expanded={Boolean(query) || !collapsed.has(group.key)}
            aria-label={m.ui_groupedCombobox_toggleGroup_ariaLabel({ group: group.label })}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              })
            }
          >
            {!query && collapsed.has(group.key)
              ? m.ui_groupedCombobox_expandGroup_label()
              : m.ui_groupedCombobox_collapseGroup_label()}
          </Button>
          {groupAction?.(group)}
        </>
      )}
    />
  );
  return tooltip ? (
    <TooltipRoot>
      <TooltipTrigger asChild>
        <div className="w-full">{picker}</div>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </TooltipRoot>
  ) : (
    picker
  );
}

export default GroupedCombobox;

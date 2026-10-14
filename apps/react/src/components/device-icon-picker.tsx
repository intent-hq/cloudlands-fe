import { useState } from 'react';
import type { DeviceIconChoice } from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';
import { deviceIconOptions, type DeviceIconOption } from '$lib/utils/device-icon-options';
import type { DeviceIconSource } from '$lib/utils/device-icon-resolver';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import { DeviceIcon } from '@/components/device-icon';

interface DeviceIconPickerProps {
  record: DeviceIconSource;
  /** Mirrors the source bindable value: external changes replace the local selection. */
  value?: DeviceIconChoice;
  disabled?: boolean;
  portal?: boolean;
  className?: string;
  contentClass?: string;
  onChange?: (value: DeviceIconChoice) => void;
}

function OptionRow({ option }: { option: DeviceIconOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <DeviceIcon record={{ deviceIcon: option.kind }} />
      <span className="truncate">{option.label}</span>
    </span>
  );
}

export function DeviceIconPicker({
  record,
  value,
  disabled = false,
  portal = false,
  className = '',
  contentClass = '',
  onChange,
}: DeviceIconPickerProps) {
  const [selection, setSelection] = useState({ incoming: value, current: value });
  // Svelte's bindable prop accepts subsequent parent values while local choices update immediately.
  const currentValue = selection.incoming === value ? selection.current : value;
  if (selection.incoming !== value) setSelection({ incoming: value, current: value });
  const options = deviceIconOptions(record);
  const selected = currentValue ?? record.deviceIcon ?? 'auto';
  const selectItems = options.map(({ value: optionValue, label }) => ({
    value: optionValue,
    label,
  }));
  const selectedOption = options.find((option) => option.value === selected);
  const automaticOption = options.find((option) => option.value === 'auto');
  const triggerLabel = m.deviceIcons_picker_trigger_ariaLabel({
    selection: selectedOption?.label ?? selected,
  });
  function choose(nextValue: string) {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option) return;
    setSelection({ incoming: value, current: option.value });
    onChange?.(option.value);
  }
  return (
    <div className={cn('w-fit shrink-0', className)} data-testid="device-icon-picker">
      <Select value={selected} items={selectItems} disabled={disabled} onValueChange={choose}>
        <SelectTrigger asChild aria-label={triggerLabel} data-testid="device-icon-picker-trigger">
          <Button
            variant="outline"
            size="icon"
            iconOnly
            className="size-(--control-height-medium) shrink-0 justify-center p-0"
            aria-label={triggerLabel}
            tooltip={triggerLabel}
          >
            <DeviceIcon record={{ ...record, deviceIcon: selected }} />
          </Button>
        </SelectTrigger>
        <SelectContent portal={portal} align="center" className={cn('w-56', contentClass)}>
          {automaticOption && (
            <SelectItem value="auto" label={automaticOption.label}>
              <OptionRow option={automaticOption} />
            </SelectItem>
          )}
          {!selectedOption && (
            <SelectItem value={selected} disabled>
              {selected}
            </SelectItem>
          )}
          <SelectGroup>
            <SelectLabel className="px-2 pb-1 pt-2 type-caption text-muted-foreground">
              {m.deviceIcons_group_devices_label()}
            </SelectLabel>
            {options
              .filter((option) => option.group === 'devices')
              .map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  <OptionRow option={option} />
                </SelectItem>
              ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel className="px-2 pb-1 pt-2 type-caption text-muted-foreground">
              {m.deviceIcons_group_wildCards_label()}
            </SelectLabel>
            {options
              .filter((option) => option.group === 'wildCards')
              .map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  <OptionRow option={option} />
                </SelectItem>
              ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

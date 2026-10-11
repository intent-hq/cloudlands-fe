// Source: src/lib/components/patterns/settings/SettingsControl.svelte.
import { useEffect, useRef, useState } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { SettingEntry, SettingsControlContext } from './types';

export interface SettingsControlProps {
  entry: Exclude<SettingEntry, { kind: 'custom' }>;
  context: SettingsControlContext;
  compact?: boolean;
}
export function SettingsControl({ entry, context, compact = true }: SettingsControlProps) {
  // get() may read a ReactStore signal inside a callback, which the automatic transform cannot detect.
  useSignals();
  const [storeValue, setStoreValue] = useState<unknown>();
  const [selectOpen, setSelectOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const onKeydown = entry.kind === 'keybinding' ? entry.onKeydown : undefined;
  useEffect(() => {
    const node = input.current;
    if (!node || !onKeydown) return;
    // Attach at the input so the native callback retains currentTarget and propagation semantics.
    node.addEventListener('keydown', onKeydown);
    return () => node.removeEventListener('keydown', onKeydown);
  }, [onKeydown]);
  const compatibilityStore = entry.store;
  useEffect(() => compatibilityStore?.subscribe(setStoreValue), [compatibilityStore]);
  const current = compatibilityStore ? storeValue : entry.get?.();
  const describedBy =
    [context.descriptionId, context.errorId].filter(Boolean).join(' ') || undefined;
  function update(value: unknown) {
    if (entry.store) entry.store.set(value as never);
    else void entry.set?.(value as never);
  }
  return (
    <div
      data-settings-control-kind={entry.kind}
      className={cn('min-w-0', !compact && entry.kind === 'switch' && 'grid')}
    >
      {entry.kind === 'switch' ? (
        <Switch
          id={context.controlId}
          size={entry.size}
          checked={Boolean(current)}
          onCheckedChange={update}
          disabled={context.disabled}
          ariaLabelledby={context.labelId}
          ariaDescribedby={describedBy}
        />
      ) : entry.kind === 'select' ? (
        <div className="w-56 max-w-full">
          <Select
            value={String(current ?? '')}
            onValueChange={update}
            disabled={context.disabled}
            open={selectOpen}
            onOpenChange={setSelectOpen}
          >
            <SelectTrigger
              id={context.controlId}
              aria-labelledby={context.labelId}
              aria-describedby={describedBy}
              onClick={(event) => {
                // Label activation remains valid after a previous mouse-pointer selection.
                if (event.detail === 0 && !context.disabled) setSelectOpen(true);
              }}
            >
              <span className="truncate">
                {entry.options.find((option) => option.value === current)?.label ??
                  entry.placeholder ??
                  String(current ?? '')}
              </span>
            </SelectTrigger>
            <SelectContent portal className="w-56 max-w-full">
              <SelectGroup>
                {entry.options.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : entry.kind === 'input' || entry.kind === 'path' || entry.kind === 'keybinding' ? (
        <Input
          ref={input}
          id={context.controlId}
          type={entry.kind === 'input' ? (entry.inputType ?? 'text') : 'text'}
          value={String(current ?? '')}
          placeholder={entry.placeholder}
          readOnly={entry.kind !== 'input' && entry.readonly}
          disabled={context.disabled}
          aria-labelledby={context.labelId}
          aria-describedby={describedBy}
          onChange={(event) => update(event.currentTarget.value)}
          onBlur={entry.kind === 'keybinding' ? undefined : entry.onBlur}
          className="w-64 max-w-full"
        />
      ) : entry.kind === 'number' ? (
        <Input
          id={context.controlId}
          type="number"
          value={typeof current === 'number' && !Number.isNaN(current) ? current : ''}
          min={entry.min}
          max={entry.max}
          step={entry.step}
          placeholder={entry.placeholder}
          disabled={context.disabled}
          aria-labelledby={context.labelId}
          aria-describedby={describedBy}
          onChange={(event) => update(event.currentTarget.valueAsNumber)}
          onBlur={entry.onBlur}
          className="w-32 max-w-full"
        />
      ) : (
        <Button
          variant={entry.variant ?? (entry.danger ? 'destructive' : 'secondary')}
          disabled={context.disabled}
          onClick={() => void entry.action()}
        >
          {entry.actionLabel}
        </Button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import type { BulkProposalItem } from '$shared/types/proposal';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { cn } from '@/lib/utils';

type Props = {
  items: BulkProposalItem[];
  selectedIds?: string[];
  disabled?: boolean;
  onSelectionChange?: (selectedIds: string[]) => void;
};

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function BulkProposalItems({
  items,
  selectedIds,
  disabled = false,
  onSelectionChange,
}: Props) {
  const [selection, setSelection] = useState(() => ({
    incoming: selectedIds,
    value: selectedIds ?? [],
  }));
  let current = selection;
  if (selectedIds !== selection.incoming) {
    current = { incoming: selectedIds, value: selectedIds ?? [] };
    setSelection(current);
  }
  const ids = current.value;

  function handleCheckedChange(item: BulkProposalItem, checked: boolean) {
    if (item.disabled || disabled) return;
    const next = checked
      ? Array.from(new Set([...ids, item.id]))
      : ids.filter((id) => id !== item.id);
    setSelection({ incoming: selectedIds, value: next });
    onSelectionChange?.(next);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-(--radius-large) border border-border bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="type-caption font-medium text-muted-foreground">
          {m.chat_bulkProposalItems_bulkChanges_label()}
        </div>
        <div className="type-caption shrink-0 text-muted-foreground">
          {m.chat_bulkProposalItems_selected_label({
            selected: formatInteger(ids.length),
            total: formatInteger(items.length),
          })}
        </div>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5',
              (item.disabled || disabled) && 'opacity-60',
            )}
          >
            <Checkbox
              checked={ids.includes(item.id)}
              disabled={item.disabled || disabled}
              ariaLabel={m.chat_bulkProposalItems_toggle_ariaLabel({ title: item.title })}
              onCheckedChange={(next) => handleCheckedChange(item, next === true)}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <div className="type-body truncate font-medium text-foreground">{item.title}</div>
                {item.disabled && (
                  <span className="type-caption rounded-(--radius-small) border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">
                    {m.chat_bulkProposalItems_locked_label()}
                  </span>
                )}
              </div>
              {item.summary && (
                <div className="type-caption break-words text-muted-foreground">{item.summary}</div>
              )}
              {(item.before !== undefined || item.after !== undefined) && (
                <div className="type-caption grid min-w-0 gap-1 sm:grid-cols-2">
                  <div className="min-w-0 break-words rounded-md bg-background px-2 py-1 text-muted-foreground">
                    <span className="font-medium">{m.chat_shared_before_label()}</span>{' '}
                    {formatValue(item.before)}
                  </div>
                  <div className="min-w-0 break-words rounded-(--radius-small) border border-primary-ink/30 bg-accent/60 px-2 py-1 text-accent-foreground">
                    <span className="font-medium">{m.chat_shared_after_label()}</span>{' '}
                    {formatValue(item.after)}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

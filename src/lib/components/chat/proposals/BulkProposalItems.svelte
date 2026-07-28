<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';
  import type { BulkProposalItem } from '$shared/types/proposal';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    items: BulkProposalItem[];
    selectedIds?: string[];
    disabled?: boolean;
    onSelectionChange?: (selectedIds: string[]) => void;
  }

  let {
    items,
    selectedIds = $bindable<string[]>([]),
    disabled = false,
    onSelectionChange,
  }: Props = $props();

  function formatValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  function handleCheckedChange(item: BulkProposalItem, checked: boolean) {
    if (item.disabled || disabled) return;
    selectedIds = checked
      ? Array.from(new Set([...selectedIds, item.id]))
      : selectedIds.filter((id) => id !== item.id);
    onSelectionChange?.(selectedIds);
  }
</script>

<div class="rounded-md border border-border/70 bg-muted/20">
  <div class="flex items-center justify-between border-b border-border/60 px-3 py-2">
    <div class="text-xs font-medium uppercase tracking-wide text-subtle">
      {m.chat_bulkProposalItems_bulkChanges_label()}
    </div>
    <div class="text-xs text-subtle">
      {m.chat_bulkProposalItems_selected_label({
        selected: formatInteger(selectedIds.length),
        total: formatInteger(items.length),
      })}
    </div>
  </div>

  <div class="divide-y divide-border/50">
    {#each items as item (item.id)}
      {@const checked = selectedIds.includes(item.id)}
      <div class="flex items-start gap-3 px-3 py-2.5" class:opacity-60={item.disabled || disabled}>
        <Checkbox
          checked={checked}
          disabled={item.disabled || disabled}
          ariaLabel={m.chat_bulkProposalItems_toggle_ariaLabel({ title: item.title })}
          onCheckedChange={(nextChecked) => handleCheckedChange(item, nextChecked)}
        />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2">
            <div class="truncate text-sm font-medium text-foreground">{item.title}</div>
            {#if item.disabled}
              <span class="rounded bg-muted px-1.5 py-0.5 text-xs text-subtle">{m.chat_bulkProposalItems_locked_label()}</span>
            {/if}
          </div>
          {#if item.summary}
            <div class="text-xs text-subtle">{item.summary}</div>
          {/if}
          {#if item.before !== undefined || item.after !== undefined}
            <div class="grid gap-1 text-xs sm:grid-cols-2">
              <div class="rounded bg-background/70 px-2 py-1 text-subtle">
                <span class="font-medium">{m.chat_shared_before_label()}</span> {formatValue(item.before)}
              </div>
              <div class="rounded bg-background/70 px-2 py-1 text-foreground">
                <span class="font-medium">{m.chat_shared_after_label()}</span> {formatValue(item.after)}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
<script lang="ts">
  import { Toggle } from '$lib/components/ui/toggle';
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

<div class="min-w-0 rounded-(--radius-medium) border border-border bg-background">
  <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
    <div class="type-caption font-medium uppercase tracking-wide text-muted-foreground">
      {m.chat_bulkProposalItems_bulkChanges_label()}
    </div>
    <div class="type-caption shrink-0 text-muted-foreground">
      {m.chat_bulkProposalItems_selected_label({
        selected: formatInteger(selectedIds.length),
        total: formatInteger(items.length),
      })}
    </div>
  </div>

  <div class="divide-y divide-border">
    {#each items as item (item.id)}
      {@const checked = selectedIds.includes(item.id)}
      <div class="flex items-start gap-3 px-3 py-2.5" class:opacity-60={item.disabled || disabled}>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2">
            <div class="type-body truncate font-medium text-foreground">{item.title}</div>
            {#if item.disabled}
              <span
                class="type-caption rounded-(--radius-small) border border-border bg-muted px-1.5 py-0.5 text-muted-foreground"
                >{m.chat_bulkProposalItems_locked_label()}</span
              >
            {/if}
          </div>
          {#if item.summary}
            <div class="type-caption break-words text-muted-foreground">{item.summary}</div>
          {/if}
          {#if item.before !== undefined || item.after !== undefined}
            <div class="type-caption grid min-w-0 gap-1 sm:grid-cols-2">
              <div
                class="min-w-0 break-words rounded-(--radius-small) border border-border bg-muted/30 px-2 py-1 text-muted-foreground"
              >
                <span class="font-medium">{m.chat_shared_before_label()}</span>
                {formatValue(item.before)}
              </div>
              <div
                class="min-w-0 break-words rounded-(--radius-small) border border-primary/30 bg-accent/60 px-2 py-1 text-accent-foreground"
              >
                <span class="font-medium">{m.chat_shared_after_label()}</span>
                {formatValue(item.after)}
              </div>
            </div>
          {/if}
        </div>
        <Toggle
          pressed={checked}
          disabled={item.disabled || disabled}
          onChange={(nextChecked) => handleCheckedChange(item, nextChecked as boolean)}
          size="xs"
          class="shrink-0"
          ariaLabel={m.chat_bulkProposalItems_toggle_ariaLabel({ title: item.title })}
        />
      </div>
    {/each}
  </div>
</div>

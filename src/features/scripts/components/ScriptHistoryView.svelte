<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import type { ScriptWithState } from '../types';
  import { canArchiveScript, searchScripts } from '../utils/script-history';
  import { formatDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  let {
    scripts,
    loading = false,
    error: loadError,
    operation,
    onSubmit,
    onInspect,
    onRetry,
  }: {
    scripts: ScriptWithState[];
    loading?: boolean;
    error?: string;
    operation?: { pending: boolean; error?: string; changed?: number; skipped?: number };
    onSubmit: (ids: string[], operation: 'archive' | 'restore') => void;
    onInspect: (id: string) => void;
    onRetry: () => void;
  } = $props();
  let view = $state<'history' | 'cleanup'>('history');
  let query = $state('');
  let selected = $state<string[]>([]);
  let reviewing = $state(false);
  let page = $state(0);
  const candidates = $derived(
    scripts.filter((s) => (view === 'history' ? !!s.archivedAt : canArchiveScript(s))),
  );
  const matches = $derived(
    searchScripts(candidates, query).toSorted((a, b) =>
      view === 'history'
        ? (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')
        : a.name.localeCompare(b.name),
    ),
  );
  const eligibleIds = $derived(new Set(candidates.map((s) => s.id)));
  const selection = $derived(selected.filter((id) => eligibleIds.has(id)));
  const rows = $derived(reviewing ? candidates.filter((s) => selection.includes(s.id)) : matches);
  const lastPage = $derived(Math.max(0, Math.ceil(rows.length / 50) - 1));
  const currentPage = $derived(Math.min(page, lastPage));
  const visible = $derived(rows.slice(currentPage * 50, (currentPage + 1) * 50));
  const busy = $derived(!!operation?.pending || loading);
  const outcomes = $derived({
    succeeded: m.scripts_history_succeeded_label(),
    failed: m.scripts_history_failed_label(),
    cancelled: m.scripts_history_cancelled_label(),
    interrupted: m.scripts_history_interrupted_label(),
  });

  function switchView(next: 'history' | 'cleanup') {
    view = next;
    selected = [];
    reviewing = false;
    page = 0;
  }
</script>

<div class="flex flex-col gap-3 min-w-0" data-script-history>
  <div class="flex flex-wrap gap-2">
    <Button
      variant="ghost"
      aria-pressed={view === 'history'}
      active={view === 'history'}
      disabled={busy}
      onclick={() => switchView('history')}>{m.scripts_history_archived_label()}</Button
    >
    <Button
      variant="ghost"
      aria-pressed={view === 'cleanup'}
      active={view === 'cleanup'}
      disabled={busy}
      onclick={() => switchView('cleanup')}>{m.scripts_history_cleanup_label()}</Button
    >
  </div>
  <Input
    value={query}
    oninput={(event) => {
      query = event.currentTarget.value;
      page = 0;
    }}
    placeholder={m.scripts_history_search_placeholder()}
    aria-label={m.scripts_history_search_placeholder()}
    disabled={reviewing}
  />
  {#if view === 'cleanup'}<p class="text-xs text-muted-foreground">
      {m.scripts_history_protection_description()}
    </p>{/if}
  {#if operation?.error}<p role="alert" class="text-sm text-danger">{operation.error}</p>{/if}
  {#if operation?.changed !== undefined}<p role="status" class="text-sm text-muted-foreground">
      {m.scripts_history_result_label({
        changed: operation.changed,
        skipped: operation.skipped ?? 0,
      })}
    </p>{/if}
  <div class="flex flex-wrap items-center gap-2">
    {#if reviewing}
      <p class="text-sm">{m.scripts_history_review_label({ count: selection.length })}</p>
      <Button variant="ghost" disabled={busy} onclick={() => (reviewing = false)}
        >{m.scripts_history_back_label()}</Button
      >
      <Button
        disabled={busy || !!loadError || selection.length === 0}
        onclick={() => {
          onSubmit(selection, view === 'history' ? 'restore' : 'archive');
          reviewing = false;
        }}
      >
        {view === 'history' ? m.scripts_history_restore_label() : m.scripts_history_archive_label()}
      </Button>
    {:else}
      <Button
        variant="ghost"
        disabled={busy || !!loadError}
        onclick={() => (selected = matches.slice(0, 1000).map((s) => s.id))}
        >{m.scripts_history_select_label()}</Button
      >
      <Button
        variant="ghost"
        disabled={busy || selection.length === 0}
        onclick={() => (selected = [])}>{m.scripts_history_clear_label()}</Button
      >
      <Button
        disabled={busy || !!loadError || selection.length === 0}
        onclick={() => {
          reviewing = true;
          page = 0;
        }}>{m.scripts_history_review_label({ count: selection.length })}</Button
      >
    {/if}
  </div>
  <ListView
    items={visible}
    getKey={(s) => s.id}
    status={loading ? 'loading' : loadError ? 'error' : 'ready'}
    ariaLabel={m.scripts_history_title()}
    virtualize={false}
    class="max-h-96 overflow-y-auto"
  >
    {#snippet error()}<div role="alert">
        <p>{m.scripts_history_load_error()}</p>
        <Button variant="ghost" onclick={onRetry}>{m.scripts_history_retry_label()}</Button>
      </div>{/snippet}
    {#snippet empty()}<p class="text-sm text-muted-foreground">
        {query ? m.scripts_history_noMatches_label() : m.scripts_history_empty_label()}
      </p>{/snippet}
    {#snippet row({ item })}
      <ListRow class="px-0">
        {#snippet leading()}<Checkbox
            checked={selection.includes(item.id)}
            ariaLabel={m.scripts_history_selectScript_label({ name: item.name })}
            disabled={busy || reviewing}
            onCheckedChange={(checked) =>
              (selected = checked
                ? [...selection, item.id].slice(0, 1000)
                : selection.filter((id) => id !== item.id))}
          />{/snippet}
        {#snippet title()}<span title={item.name}>{item.name}</span>{/snippet}
        {#snippet description()}
          <p class="truncate font-mono" title={item.command}>{item.command}</p>
          <p>
            {item.lastRun ? outcomes[item.lastRun.outcome] : m.scripts_history_unknown_label()}{item
              .lastRun?.exitCode !== undefined
              ? m.scripts_history_exit_label({ code: item.lastRun.exitCode })
              : ''}
          </p>
          {#if item.lastRun}<p>{formatDateTime(item.lastRun.stoppedAt)}</p>{/if}
          {#if item.lastRun?.error}<p class="break-words">{item.lastRun.error}</p>{/if}
        {/snippet}
        {#snippet trailing()}<Button variant="ghost" size="sm" onclick={() => onInspect(item.id)}
            >{m.scripts_history_output_label()}</Button
          >{/snippet}
      </ListRow>
    {/snippet}
  </ListView>
  <div class="flex items-center justify-between gap-2">
    <Button variant="ghost" disabled={currentPage === 0} onclick={() => (page = currentPage - 1)}
      >{m.scripts_history_previous_label()}</Button
    >
    <span class="text-xs text-muted-foreground"
      >{m.scripts_history_page_label({
        page: currentPage + 1,
        pages: lastPage + 1,
        count: rows.length,
      })}</span
    >
    <Button
      variant="ghost"
      disabled={currentPage === lastPage}
      onclick={() => (page = currentPage + 1)}>{m.scripts_history_next_label()}</Button
    >
  </div>
  <p class="text-xs text-muted-foreground">{m.scripts_history_output_description()}</p>
</div>

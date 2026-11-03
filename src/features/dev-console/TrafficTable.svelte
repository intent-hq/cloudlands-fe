<script lang="ts" generics="Row extends { id: string }, Column extends string">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { formatInteger, formatNumber, formatDatePattern } from '$lib/i18n/format';
  import { tick, untrack } from 'svelte';
  import type { DevConsoleRow } from '$shared/types/dev-console';
  import type { TrafficColumn } from './traffic-view';
  import { trafficBytes, trafficStream } from './traffic-view';
  import { statusLabel, trafficTabLabel } from './traffic-labels';
  import * as m from '$shared/paraglide/messages.js';
  let {
    rows,
    combined = false,
    selected,
    onselect,
    column,
    descending,
    onsort,
    columns: customColumns,
    cells,
    streamOf,
    label,
    empty,
  }: {
    rows: Row[];
    combined?: boolean;
    selected: string | null;
    onselect: (id: string) => void;
    column: Column;
    descending: boolean;
    onsort: (column: Column, descending: boolean) => void;
    /** Custom columns (id, header). Requires `cells`; replaces the RPC columns. */
    columns?: [Column, string][];
    /** Renders one row's `role="cell"` elements in `columns` order. */
    cells?: Snippet<[Row]>;
    /** Row tint stream for custom rows (`outbound`, `inbound` or `events`). */
    streamOf?: (row: Row) => string | null;
    label?: string;
    empty?: string;
  } = $props();
  const rpc = (row: Row) => row as unknown as DevConsoleRow;
  const custom = $derived(!!customColumns && !!cells);
  const rowHeight = 25;
  let viewport: HTMLDivElement;
  let height = $state(400),
    top = $state(0),
    following = $state(true);
  let previous: Row[] = [];
  let previousSort = '';
  const start = $derived(Math.max(0, Math.floor(Math.max(0, top - 27) / rowHeight) - 8));
  const end = $derived(Math.min(rows.length, start + Math.ceil(height / rowHeight) + 18));
  const visibleSelection = $derived(rows.slice(start, end).some((row) => row.id === selected));
  const rpcColumns = $derived([
    ['timestamp', m.devConsole_time_label()],
    ['method', m.devConsole_method_label()],
    ['kind', m.devConsole_kind_label()],
    ['requestId', m.devConsole_id_label()],
    ['status', m.devConsole_status_label()],
    ['durationMs', m.devConsole_duration_label()],
    ['bytes', m.devConsole_bytes_label()],
    ['backendId', m.devConsole_backend_label()],
  ] as [TrafficColumn, string][]);
  const columns = $derived(custom ? customColumns! : (rpcColumns as unknown as [Column, string][]));
  $effect(() => {
    const next = rows,
      sort = `${column}:${descending}`;
    untrack(() => {
      const anchor = previous[Math.max(0, Math.floor((top - 27) / rowHeight))]?.id;
      const offset = (top - 27) % rowHeight;
      const sortChanged = previousSort && previousSort !== sort;
      previous = next;
      previousSort = sort;
      if (sortChanged) following = false;
      void tick().then(() => {
        if (!viewport) return;
        if (following && column === 'timestamp' && !descending)
          viewport.scrollTop = viewport.scrollHeight;
        else if (sortChanged) viewport.scrollTop = 0;
        else if (anchor) {
          const index = next.findIndex((row) => row.id === anchor);
          viewport.scrollTop = index < 0 ? 0 : index * rowHeight + 27 + offset;
        }
        top = viewport.scrollTop;
      });
    });
  });
  $effect(() => {
    height;
    untrack(() => {
      if (following && viewport) {
        viewport.scrollTop = viewport.scrollHeight;
        top = viewport.scrollTop;
      }
    });
  });
  function scroll() {
    top = viewport.scrollTop;
    following =
      column === 'timestamp' && !descending && viewport.scrollHeight - height - top < rowHeight;
  }
  async function live() {
    onsort('timestamp' as Column, false);
    await tick();
    following = true;
    viewport.scrollTop = viewport.scrollHeight;
    top = viewport.scrollTop;
  }
  export async function focusRecord(id: string) {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    following = false;
    const y = 27 + index * rowHeight;
    if (y < viewport.scrollTop + 27 || y + rowHeight > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = Math.max(0, y - viewport.clientHeight / 2);
    }
    // Showing a hidden viewport can restore native scrollTop without a scroll event.
    top = viewport.scrollTop;
    await tick();
    viewport.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });
  }
  async function key(event: KeyboardEvent, index: number) {
    let target = index;
    if (event.key === 'ArrowDown') target++;
    else if (event.key === 'ArrowUp') target--;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = rows.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onselect(rows[index].id);
      return;
    } else return;
    event.preventDefault();
    target = Math.max(0, Math.min(rows.length - 1, target));
    following = false;
    onselect(rows[target].id);
    const y = 27 + target * rowHeight;
    if (y < top + 27 || y + rowHeight > top + height) {
      viewport.scrollTop = Math.max(0, y - height / 2);
      top = viewport.scrollTop;
    }
    await tick();
    viewport.querySelector<HTMLElement>(`[data-index="${target}"]`)?.focus({ preventScroll: true });
  }
</script>

<div class="traffic-table" class:combined={combined && !custom} class:custom>
  <div class="follow">
    <span>{following ? m.devConsole_following_label() : m.devConsole_paused_label()}</span><Button
      size="compact"
      variant="ghost"
      wrapContent={false}
      class="table-control"
      onclick={live}>{m.devConsole_live_label()}</Button
    >
  </div>
  <div class="viewport" bind:this={viewport} bind:clientHeight={height} onscroll={scroll}>
    <div
      role="table"
      aria-label={label ?? m.devConsole_title_label()}
      aria-rowcount={rows.length + 1}
    >
      <div role="row" class="columns header">
        {#each columns as [id, label]}<div
            role="columnheader"
            aria-sort={column === id ? (descending ? 'descending' : 'ascending') : 'none'}
          >
            <Button
              size="compact"
              variant="ghost"
              wrapContent={false}
              class="table-control"
              onclick={() => onsort(id, column === id ? !descending : false)}
              >{label}{column === id ? (descending ? ' ↓' : ' ↑') : ''}</Button
            >
          </div>
          {#if combined && !custom && id === 'timestamp'}<div
              role="columnheader"
              class="stream-heading"
            >
              {m.devConsole_stream_label()}
            </div>{/if}
        {/each}
      </div>
      <div style:height={`${start * rowHeight}px`} aria-hidden="true"></div>
      {#each rows.slice(start, end) as row, i (row.id)}
        <div
          role="row"
          class="columns record"
          class:selected={selected === row.id}
          data-stream={custom
            ? (streamOf?.(row) ?? undefined)
            : combined
              ? trafficStream(rpc(row))
              : undefined}
          data-index={start + i}
          aria-rowindex={start + i + 2}
          aria-selected={selected === row.id}
          tabindex={selected === row.id || (!visibleSelection && i === 0) ? 0 : -1}
          onclick={() => onselect(row.id)}
          onkeydown={(event) => key(event, start + i)}
        >
          {#if custom}{@render cells!(row)}{:else}
            {@const r = rpc(row)}
            <span role="cell">{formatDatePattern(r.timestamp, 'HH:mm:ss.SSS')}</span>
            {#if combined}
              {@const stream = trafficStream(r)}
              <span role="cell" use:truncatedTitle={stream ? trafficTabLabel(stream) : ''}
                >{stream ? trafficTabLabel(stream) : '—'}</span
              >
            {/if}
            <span role="cell" class="method" use:truncatedTitle={r.method}>{r.method}</span>
            <span role="cell"
              >{r.kind === 'request'
                ? m.devConsole_request_label()
                : m.devConsole_event_label()}</span
            >
            <span role="cell" use:truncatedTitle={String(r.requestId ?? '')}
              >{r.requestId ?? '—'}</span
            >
            <span
              role="cell"
              class:error={['error', 'timeout', 'disconnected', 'send-error'].includes(r.status)}
              >{statusLabel(r.status)}</span
            >
            <span role="cell"
              >{r.durationMs === undefined
                ? '—'
                : `${formatNumber(r.durationMs, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ms`}</span
            >
            <span role="cell" title={`${r.payload.state} / ${r.response?.state ?? ''}`}
              >{formatInteger(trafficBytes(r))}{r.payload.state === 'truncated' ||
              r.response?.state === 'truncated'
                ? ' *'
                : ''}</span
            >
            <span role="cell" title={`${r.backendId} / ${r.connectionId}`}>{r.backendId}</span>
          {/if}
        </div>
      {/each}
      <div
        style:height={`${Math.max(0, rows.length - end) * rowHeight}px`}
        aria-hidden="true"
      ></div>
    </div>
    {#if rows.length === 0}<p class="empty">{empty ?? m.devConsole_empty_label()}</p>{/if}
  </div>
</div>

<style>
  .traffic-table {
    flex: 1;
    min-height: 100px;
    display: flex;
    flex-direction: column;
  }
  @media (max-height: 500px) {
    .traffic-table {
      min-height: 78px;
    }
  }
  .follow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 10px;
    border-bottom: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
  }
  .traffic-table :global(.table-control) {
    font: inherit;
    color: inherit;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .traffic-table :global(.table-control):focus-visible,
  .record:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }
  .viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
  }
  .columns {
    display: grid;
    grid-template-columns: 116px minmax(240px, 1fr) 78px 94px 104px 86px 80px 120px;
    min-width: 940px;
    align-items: center;
  }
  .custom .columns {
    grid-template-columns: var(--traffic-columns);
    min-width: var(--traffic-min-width, 940px);
  }
  .combined .columns {
    grid-template-columns: 116px 150px minmax(240px, 1fr) 78px 94px 104px 86px 80px 120px;
    min-width: 1090px;
  }
  .stream-heading {
    padding: 0 7px;
  }
  .header {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 27px;
    background: hsl(var(--muted));
    border-bottom: 1px solid hsl(var(--border));
  }
  .header :global(.table-control) {
    text-align: left;
    justify-content: flex-start;
    width: 100%;
    white-space: nowrap;
  }
  .header > div {
    border-right: 1px solid hsl(var(--border));
  }
  .record {
    height: 25px;
    cursor: default;
    border-bottom: 1px solid hsl(var(--border) / 0.4);
  }
  .record:nth-child(even) {
    background: hsl(var(--muted) / 0.35);
  }
  .record[data-stream='outbound'] {
    background: hsl(var(--info) / 0.07);
  }
  .record[data-stream='inbound'] {
    background: hsl(var(--success) / 0.07);
  }
  .record[data-stream='events'] {
    background: hsl(var(--warning) / 0.07);
  }
  .record:hover {
    background: hsl(var(--accent));
  }
  .record.selected {
    background: hsl(var(--accent));
    box-shadow: inset 3px 0 hsl(var(--ring));
  }
  .record :global(span[role='cell']),
  .record span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0 7px;
  }
  .method {
    font-weight: 500;
  }
  .error {
    color: hsl(var(--danger));
  }
  .empty {
    padding: 24px;
    color: hsl(var(--muted-foreground));
  }
  .traffic-table :global(.table-control) {
    height: auto;
    min-height: 0;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
  }
</style>

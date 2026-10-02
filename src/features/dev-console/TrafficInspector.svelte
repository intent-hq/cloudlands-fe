<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { onDestroy, tick } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import type { DevConsoleState } from '$store/renderer/dev-console/dev-console-slice';
  import type { connectDevConsole } from '$store/renderer/dev-console/dev-console-bridge';
  import type { DevConsoleCaptureSelection, DevConsoleRecord } from '$shared/types/dev-console';
  import {
    orderTraffic,
    selectedPayloadReader,
    type TrafficColumn,
    type TrafficTab,
  } from './traffic-view';
  import { trafficTabLabel } from './traffic-labels';
  import TrafficTable from './TrafficTable.svelte';
  import PayloadDetails from './PayloadDetails.svelte';
  import * as m from '$shared/paraglide/messages.js';
  let {
    consoleState,
    bridge,
  }: { consoleState: DevConsoleState; bridge: ReturnType<typeof connectDevConsole> | undefined } =
    $props();
  let direction = $state<TrafficTab>('all');
  const tabs: TrafficTab[] = ['all', 'outbound', 'inbound', 'events'];
  let filter = $state(''),
    column = $state<TrafficColumn>('timestamp'),
    descending = $state(false);
  let selected = $state<string | null>(null),
    record = $state<DevConsoleRecord | null>(null),
    error = $state('');
  const rows = $derived(
    orderTraffic(
      (consoleState.update?.recordIds ?? []).map((id) => consoleState.rows[id]).filter(Boolean),
      direction,
      filter,
      column,
      descending,
    ),
  );
  const selectedRow = $derived(selected ? (consoleState.rows[selected] ?? null) : null);
  let panel: HTMLDivElement;
  let panelHeight = $state(0);
  let minimumDetailsHeight = $state(0);
  const compact = $derived(panelHeight < minimumDetailsHeight + 100);
  $effect.pre(() => {
    if (
      compact &&
      selectedRow &&
      panel?.querySelector('.traffic-table')?.contains(document.activeElement)
    ) {
      void tick().then(() =>
        panel.querySelector<HTMLButtonElement>('[data-close-details]')?.focus(),
      );
    }
  });
  let table = $state.raw<{ focusRecord: (id: string) => Promise<void> }>();
  const reader = selectedPayloadReader(
    async (id) => bridge?.record(id) ?? null,
    (value) => {
      record = value;
    },
    (message) => {
      error = message;
    },
  );
  const matches = (a: DevConsoleCaptureSelection, b: DevConsoleCaptureSelection) =>
    a.direction === b.direction && a.kind === b.kind && a.method === b.method;
  const full = $derived(
    selectedRow
      ? (consoleState.update?.fullCapture ?? []).some((choice) => matches(choice, selectedRow))
      : false,
  );
  let previousSession = '';
  $effect(() => {
    const session = consoleState.update?.sessionId ?? '';
    if (session !== previousSession) {
      previousSession = session;
      selected = null;
      reader.select('', null);
    }
    const row = selectedRow;
    if (!row || !rows.some((candidate) => candidate.id === row.id)) {
      selected = null;
      reader.select('', null);
    } else reader.select(consoleState.update?.sessionId ?? '', row);
  });
  onDestroy(() => reader.dispose());
  async function selectRecord(id: string) {
    selected = id;
    error = '';
    await tick();
    if (selected === id && compact) {
      panel.querySelector<HTMLButtonElement>('[data-close-details]')?.focus();
    }
  }
  async function closeDetails() {
    const id = selected;
    selected = null;
    await tick();
    if (id) await table?.focusRecord(id);
  }
  function sort(next: TrafficColumn, reverse: boolean) {
    column = next;
    descending = reverse;
  }
  function tab(next: TrafficTab) {
    direction = next;
    selected = null;
    reader.select('', null);
  }
  async function clear() {
    selected = null;
    reader.select('', null);
    error = '';
    try {
      if (!(await bridge?.clear())) error = m.devConsole_disabled_label();
    } catch (e) {
      error = String(e);
    }
  }
  async function toggle(selection: DevConsoleCaptureSelection, enabled: boolean) {
    error = '';
    try {
      if (
        !(await bridge?.select(
          { direction: selection.direction, kind: selection.kind, method: selection.method },
          enabled,
        ))
      )
        error = m.devConsole_disabled_label();
    } catch (e) {
      error = String(e);
    }
  }
</script>

<div class="inspector">
  <div class="toolbar">
    <div role="tablist" aria-label={m.devConsole_title_label()}>
      {#each tabs as value}<Button
          size="compact"
          variant="ghost"
          wrapContent={false}
          class="inspector-control"
          role="tab"
          id={`tab-${value}`}
          aria-controls="traffic-panel"
          aria-selected={direction === value}
          tabindex={direction === value ? 0 : -1}
          onclick={() => tab(value)}
          onkeydown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const index = tabs.indexOf(direction);
              const next =
                event.key === 'Home'
                  ? tabs[0]
                  : event.key === 'End'
                    ? tabs[tabs.length - 1]
                    : tabs[
                        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
                      ];
              tab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }
          }}>{trafficTabLabel(value)}</Button
        >{/each}
    </div>
    <span class="connection"
      >{consoleState.update
        ? `${m.devConsole_connected_label()} · ${consoleState.update.backendId}`
        : m.devConsole_connecting_label()}</span
    >
  </div>
  <div class="tools">
    <Input
      size="compact"
      class="inspector-input"
      aria-label={m.devConsole_filter_label()}
      placeholder={m.devConsole_filter_label()}
      bind:value={filter}
    /><Button
      size="compact"
      variant="ghost"
      wrapContent={false}
      class="inspector-control"
      onclick={clear}>{m.devConsole_clear_label()}</Button
    >
    {#if consoleState.update?.fullCapture.length}<details>
        <summary
          >{m.devConsole_captureChoices_label()} ({formatInteger(
            consoleState.update.fullCapture.length,
          )})</summary
        >{#each consoleState.update.fullCapture as choice}<div class="choice">
            <code>{choice.direction} / {choice.kind} / {choice.method}</code><Button
              size="compact"
              variant="ghost"
              wrapContent={false}
              class="inspector-control"
              onclick={() => toggle(choice, false)}>{m.devConsole_removeChoice_label()}</Button
            >
          </div>{/each}
      </details>{/if}
  </div>
  {#if consoleState.error || error}<div role="alert">{consoleState.error || error}</div>{/if}
  <div
    role="tabpanel"
    id="traffic-panel"
    aria-labelledby={`tab-${direction}`}
    class:inspecting={!!selectedRow}
    class:compact
    bind:this={panel}
    bind:clientHeight={panelHeight}
  >
    {#key direction}<TrafficTable
        bind:this={table}
        {rows}
        combined={direction === 'all'}
        {selected}
        onselect={selectRecord}
        {column}
        {descending}
        onsort={sort}
      />{/key}
    {#if selectedRow}{#key selectedRow.id}<PayloadDetails
          row={selectedRow}
          {record}
          {full}
          height={compact ? panelHeight : Math.max(panelHeight * 0.38, minimumDetailsHeight)}
          onminimumheight={(height) => {
            minimumDetailsHeight = height;
          }}
          ontoggle={(enabled) => toggle(selectedRow, enabled)}
          onclose={closeDetails}
        />{/key}
    {:else}<div class="hint">{m.devConsole_select_label()}</div>{/if}
  </div>
  {#if consoleState.update}<footer>
      <span
        >{m.devConsole_accounting_label({
          shown: formatInteger(rows.length),
          retained: formatInteger(consoleState.update.recordIds.length),
          evicted: formatInteger(consoleState.update.evictedRecords),
          dropped: formatInteger(consoleState.update.droppedRecords),
          oversize: formatInteger(consoleState.update.oversizePayloads),
        })}</span
      ><span
        >{m.devConsole_limits_label({
          bytes: formatInteger(consoleState.update.retainedPayloadBytes),
          budget: formatInteger(consoleState.update.limits.maxPayloadBytes),
          rows: formatInteger(consoleState.update.limits.maxRecords),
          preview: formatInteger(consoleState.update.limits.previewBytes),
        })}</span
      >
    </footer>{/if}
</div>

<style>
  .inspecting.compact :global(.traffic-table) {
    display: none;
  }
  .inspector {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font:
      11px ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
  }
  .toolbar,
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    border-bottom: 1px solid hsl(var(--border));
  }
  .toolbar {
    min-height: 34px;
    background: hsl(var(--muted) / 0.5);
  }
  [role='tablist'] {
    display: flex;
    align-self: stretch;
  }
  .inspector :global(.inspector-control) {
    cursor: pointer;
    font: inherit;
    padding: 3px 8px;
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
  }
  .toolbar :global([role='tab']) {
    border: 0;
    border-radius: 0;
    padding: 6px 12px;
  }
  .toolbar :global([aria-selected='true']) {
    box-shadow: inset 0 -2px hsl(var(--ring));
    background: hsl(var(--accent));
  }
  .inspector :global(.inspector-control):focus-visible,
  .inspector :global(.inspector-input):focus-visible,
  summary:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }
  .connection {
    margin-left: auto;
    color: hsl(var(--muted-foreground));
  }
  .tools {
    min-height: 35px;
    flex-wrap: wrap;
    padding-block: 4px;
  }
  .inspector :global(.inspector-input) {
    border: 1px solid hsl(var(--border));
    border-radius: 3px;
    padding: 4px 7px;
    background: hsl(var(--background));
    width: 270px;
    font: inherit;
  }
  details {
    position: relative;
  }
  .choice {
    display: flex;
    gap: 8px;
    padding: 5px;
  }
  [role='tabpanel'] {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  [role='alert'] {
    padding: 6px 10px;
    color: hsl(var(--danger));
  }
  .hint,
  footer {
    padding: 5px 10px;
    border-top: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
  }
  .inspector :global(.inspector-control) {
    height: auto;
    min-height: 0;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
  }
  .inspector :global(.inspector-input) {
    height: auto;
    min-height: 0;
  }
</style>
